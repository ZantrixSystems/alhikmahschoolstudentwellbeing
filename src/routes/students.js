const express = require('express');
const { query, withClient } = require('../db');
const { asyncHandler, AppError } = require('../lib/http');
const { parseFilter, compileFilter, buildFieldRule, pushParam } = require('../lib/filtering');
const { assertPermission, getEffectivePermissionKeys } = require('../services/authz');
const { getVisibilityMatrix, computeVisibility, redactRecord } = require('../services/visibility');
const { writeAuditLog } = require('../services/audit');

const router = express.Router();

function getStudentFieldMap() {
  return {
    status: buildFieldRule('s.current_status'),
    yearGroup: buildFieldRule('s.year_group'),
    tutorGroup: buildFieldRule('s.tutor_group'),
    safeguardingFlag: buildFieldRule('s.safeguarding_flag', { type: 'boolean', allowOperators: ['==', '!='] }),
    attendanceConcern: buildFieldRule('s.attendance_concern', { type: 'boolean', allowOperators: ['==', '!='] }),
    createdAt: buildFieldRule('s.created_at', { type: 'date' }),
    radarTeam: (operator, value, params) => {
      if (!['==', '=in='].includes(operator)) {
        throw new AppError(400, 'radarTeam only supports == and =in=');
      }
      const values = Array.isArray(value) ? value : [value];
      const placeholders = values.map((entry) => pushParam(params, entry)).join(', ');
      return {
        sql: `EXISTS (
          SELECT 1
          FROM student_team_radar str
          JOIN teams t ON t.id = str.team_id
          WHERE str.student_id = s.id
            AND str.deleted_at IS NULL
            AND str.status IN ('active', 'monitoring')
            AND t.team_key IN (${placeholders})
        )`,
      };
    },
    hasOpenConcern: (operator, value, params) => {
      if (operator !== '==') {
        throw new AppError(400, 'hasOpenConcern only supports ==');
      }
      const expected = pushParam(params, value);
      return {
        sql: `(EXISTS (
          SELECT 1
          FROM concerns c
          WHERE c.student_id = s.id
            AND c.deleted_at IS NULL
            AND c.status IN ('open', 'triage', 'escalated')
        ) = ${expected})`,
      };
    },
  };
}

router.get(
  '/students',
  asyncHandler(async (req, res) => {
    await assertPermission(req, 'students.view');

    const search = (req.query.q || '').trim();
    const params = [];
    const filterAst = parseFilter(req.query.filter || '');
    const filterSql = compileFilter(filterAst, getStudentFieldMap(), params).sql;
    let searchSql = 'TRUE';

    if (search) {
      const placeholder = pushParam(params, `%${search.toLowerCase()}%`);
      searchSql = `(LOWER(s.first_name) LIKE ${placeholder} OR LOWER(s.last_name) LIKE ${placeholder} OR LOWER(s.student_code) LIKE ${placeholder})`;
    }

    const result = await query(
      `
        SELECT
          s.id,
          s.student_code,
          s.first_name,
          s.last_name,
          s.preferred_name,
          s.year_group,
          s.tutor_group,
          s.current_status,
          s.safeguarding_flag,
          s.attendance_concern,
          s.notes_summary,
          COALESCE(
            JSON_AGG(
              DISTINCT JSONB_BUILD_OBJECT(
                'teamKey', t.team_key,
                'teamName', t.name,
                'status', str.status,
                'severity', str.severity,
                'addedAt', str.added_at
              )
            ) FILTER (WHERE str.id IS NOT NULL),
            '[]'::json
          ) AS radar
        FROM students s
        LEFT JOIN student_team_radar str
          ON str.student_id = s.id
         AND str.deleted_at IS NULL
         AND str.status IN ('active', 'monitoring', 'paused')
        LEFT JOIN teams t ON t.id = str.team_id
        WHERE s.deleted_at IS NULL
          AND ${filterSql}
          AND ${searchSql}
        GROUP BY s.id
        ORDER BY s.last_name, s.first_name
        LIMIT 100
      `,
      params
    );

    res.json({
      students: result.rows,
      filter: req.query.filter || '',
    });
  })
);

router.get(
  '/students/:id',
  asyncHandler(async (req, res) => {
    await assertPermission(req, 'students.view');

    const student = await query(
      `
        SELECT
          s.*,
          COALESCE(
            JSON_AGG(
              DISTINCT JSONB_BUILD_OBJECT(
                'id', f.id,
                'flagKey', f.flag_key,
                'label', f.label,
                'severity', f.severity,
                'visibilityLevel', f.visibility_level
              )
            ) FILTER (WHERE f.id IS NOT NULL AND f.deleted_at IS NULL AND f.is_active = TRUE),
            '[]'::json
          ) AS flags
        FROM students s
        LEFT JOIN student_flags f ON f.student_id = s.id
        WHERE s.id = $1
          AND s.deleted_at IS NULL
        GROUP BY s.id
      `,
      [req.params.id]
    );

    if (!student.rows[0]) {
      throw new AppError(404, 'Student not found');
    }

    const profile = student.rows[0];

    const permissionKeys = req.auth.isAdmin ? ['*'] : await getEffectivePermissionKeys(req.auth.userId);

    const payload = await withClient(async (client) => {
      const matrix = await getVisibilityMatrix(client, req.auth.teamIds);

      const [radarResult, concernsResult, meetingsResult, actionsResult, chronologyResult] = await Promise.all([
        client.query(
          `
            SELECT
              str.id,
              str.team_id,
              t.name AS team_name,
              t.team_key,
              str.status,
              str.category,
              str.reason_summary AS summary,
              str.detail_note AS detail,
              str.severity,
              str.visibility_level,
              str.added_at AS occurred_at,
              str.offboarded_at,
              u.display_name AS assigned_lead_name
            FROM student_team_radar str
            JOIN teams t ON t.id = str.team_id
            LEFT JOIN users u ON u.id = str.assigned_lead_user_id
            WHERE str.student_id = $1
              AND str.deleted_at IS NULL
            ORDER BY str.added_at DESC
          `,
          [req.params.id]
        ),
        client.query(
          `
            SELECT
              c.id,
              c.team_id,
              t.name AS team_name,
              c.title,
              c.summary,
              c.detail,
              c.status,
              c.category,
              c.severity,
              c.urgency,
              c.confidentiality_level,
              c.created_at,
              c.created_at AS occurred_at
            FROM concerns c
            LEFT JOIN teams t ON t.id = c.team_id
            WHERE c.student_id = $1
              AND c.deleted_at IS NULL
            ORDER BY c.created_at DESC
          `,
          [req.params.id]
        ),
        client.query(
          `
            SELECT
              m.id,
              m.team_id,
              t.name AS team_name,
              m.title,
              m.summary,
              m.detail,
              m.interaction_type,
              m.visibility_level,
              m.occurred_at,
              m.created_at
            FROM meetings m
            LEFT JOIN teams t ON t.id = m.team_id
            WHERE m.student_id = $1
              AND m.deleted_at IS NULL
            ORDER BY m.occurred_at DESC
          `,
          [req.params.id]
        ),
        client.query(
          `
            SELECT
              a.id,
              a.team_id,
              t.name AS team_name,
              a.title,
              a.summary,
              a.status,
              a.priority,
              a.due_at,
              a.completed_at,
              a.created_at,
              a.created_at AS occurred_at
            FROM actions a
            LEFT JOIN teams t ON t.id = a.team_id
            WHERE a.student_id = $1
              AND a.deleted_at IS NULL
            ORDER BY a.created_at DESC
          `,
          [req.params.id]
        ),
        client.query(
          `
            SELECT
              ce.id,
              ce.team_id,
              t.name AS team_name,
              ce.title,
              ce.summary,
              ce.detail,
              ce.event_type,
              ce.visibility_level,
              ce.occurred_at,
              ce.created_at
            FROM chronology_events ce
            LEFT JOIN teams t ON t.id = ce.team_id
            WHERE ce.student_id = $1
              AND ce.deleted_at IS NULL
            ORDER BY ce.occurred_at DESC
            LIMIT 100
          `,
          [req.params.id]
        ),
      ]);

      const applyVisibility = (records, contentType, visibilityField = 'visibility_level') =>
        records
          .map((record) => {
            const visibility = computeVisibility({
              auth: req.auth,
              matrix,
              ownerTeamId: record.team_id,
              contentType,
              recordVisibilityLevel: record[visibilityField] || 'full',
            });
            return redactRecord(record, visibility);
          })
          .filter(Boolean);

      return {
        profile,
        radar: applyVisibility(radarResult.rows, 'radar', 'visibility_level'),
        concerns: req.auth.isAdmin || permissionKeys.includes('concerns.review')
          ? applyVisibility(concernsResult.rows, 'concerns', 'confidentiality_level')
          : [],
        meetings: req.auth.isAdmin || permissionKeys.includes('meetings.view')
          ? applyVisibility(meetingsResult.rows, 'meetings', 'visibility_level')
          : [],
        actions: req.auth.isAdmin || permissionKeys.includes('actions.manage')
          ? applyVisibility(actionsResult.rows, 'actions', 'visibility_level')
          : [],
        chronology: req.auth.isAdmin || permissionKeys.includes('chronology.view')
          ? applyVisibility(chronologyResult.rows, 'chronology', 'visibility_level')
          : [],
      };
    });

    await writeAuditLog(req.auth, {
      areaKey: 'students',
      actionKey: 'profile.view',
      entityType: 'student',
      entityId: req.params.id,
      studentId: req.params.id,
      metadata: { sensitiveRead: true },
    });

    res.json(payload);
  })
);

router.post(
  '/students/:id/radar',
  asyncHandler(async (req, res) => {
    await assertPermission(req, 'radar.manage');
    const { teamId, status = 'active', category = null, reasonSummary, detailNote = null, severity = 'medium', visibilityLevel = 'summary', assignedLeadUserId = null } = req.body || {};

    if (!teamId || !reasonSummary) {
      throw new AppError(400, 'teamId and reasonSummary are required');
    }

    const result = await query(
      `
        INSERT INTO student_team_radar (
          student_id,
          team_id,
          status,
          category,
          reason_summary,
          detail_note,
          severity,
          visibility_level,
          assigned_lead_user_id,
          created_by,
          updated_by
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)
        RETURNING *
      `,
      [req.params.id, teamId, status, category, reasonSummary, detailNote, severity, visibilityLevel, assignedLeadUserId, req.auth.userId]
    );

    await query(
      `
        INSERT INTO chronology_events (
          student_id,
          source_table,
          source_id,
          event_type,
          team_id,
          actor_user_id,
          visibility_level,
          title,
          summary,
          detail,
          created_by
        )
        VALUES ($1, 'student_team_radar', $2, 'team_onboarded', $3, $4, $5, $6, $7, $8, $4)
      `,
      [
        req.params.id,
        result.rows[0].id,
        teamId,
        visibilityLevel,
        'Student onboarded to team radar',
        reasonSummary,
        detailNote,
      ]
    );

    res.status(201).json({ radar: result.rows[0] });
  })
);

module.exports = router;
