const express = require('express');
const { query } = require('../db');
const { asyncHandler, AppError } = require('../lib/http');
const { parseFilter, compileFilter, buildFieldRule, pushParam } = require('../lib/filtering');
const { assertPermission } = require('../services/authz');

const router = express.Router();

function meetingFieldMap() {
  return {
    teamId: buildFieldRule('m.team_id'),
    interactionType: buildFieldRule('m.interaction_type'),
    createdAt: buildFieldRule('m.created_at', { type: 'date' }),
    occurredAt: buildFieldRule('m.occurred_at', { type: 'date' }),
  };
}

router.get(
  '/meetings',
  asyncHandler(async (req, res) => {
    await assertPermission(req, 'meetings.view');

    const params = [];
    const filterSql = compileFilter(parseFilter(req.query.filter || ''), meetingFieldMap(), params).sql;
    const search = (req.query.q || '').trim().toLowerCase();
    let searchSql = 'TRUE';

    if (search) {
      const placeholder = pushParam(params, `%${search}%`);
      searchSql = `(LOWER(m.title) LIKE ${placeholder} OR LOWER(m.summary) LIKE ${placeholder} OR LOWER(s.first_name) LIKE ${placeholder} OR LOWER(s.last_name) LIKE ${placeholder})`;
    }

    const result = await query(
      `
        SELECT
          m.id,
          m.student_id,
          s.first_name,
          s.last_name,
          s.year_group,
          m.title,
          m.summary,
          m.interaction_type,
          m.visibility_level,
          m.occurred_at,
          t.name AS team_name
        FROM meetings m
        JOIN students s ON s.id = m.student_id
        LEFT JOIN teams t ON t.id = m.team_id
        WHERE m.deleted_at IS NULL
          AND s.deleted_at IS NULL
          AND ${filterSql}
          AND ${searchSql}
        ORDER BY m.occurred_at DESC
        LIMIT 100
      `,
      params
    );

    res.json({ meetings: result.rows, filter: req.query.filter || '' });
  })
);

router.post(
  '/meetings',
  asyncHandler(async (req, res) => {
    await assertPermission(req, 'meetings.create');
    const {
      studentId,
      teamId = null,
      interactionType,
      title,
      summary,
      detail = null,
      visibilityLevel = 'summary',
      confidentialityLevel = 'summary',
      occurredAt,
    } = req.body || {};

    if (!studentId || !interactionType || !title || !summary || !occurredAt) {
      throw new AppError(400, 'studentId, interactionType, title, summary, and occurredAt are required');
    }

    const result = await query(
      `
        INSERT INTO meetings (
          student_id,
          team_id,
          logged_by_user_id,
          interaction_type,
          visibility_level,
          confidentiality_level,
          title,
          summary,
          detail,
          occurred_at,
          created_by,
          updated_by
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $3, $3)
        RETURNING *
      `,
      [studentId, teamId, req.auth.userId, interactionType, visibilityLevel, confidentialityLevel, title, summary, detail, occurredAt]
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
          confidentiality_level,
          title,
          summary,
          detail,
          occurred_at,
          created_by
        )
        VALUES ($1, 'meetings', $2, 'meeting_logged', $3, $4, $5, $6, $7, $8, $9, $10, $4)
      `,
      [studentId, result.rows[0].id, teamId, req.auth.userId, visibilityLevel, confidentialityLevel, title, summary, detail, occurredAt]
    );

    res.status(201).json({ meeting: result.rows[0] });
  })
);

module.exports = router;
