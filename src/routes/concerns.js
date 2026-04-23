const express = require('express');
const { query } = require('../db');
const { asyncHandler, AppError } = require('../lib/http');
const { parseFilter, compileFilter, buildFieldRule, pushParam } = require('../lib/filtering');
const { assertPermission } = require('../services/authz');

const router = express.Router();

function concernFieldMap() {
  return {
    status: buildFieldRule('c.status'),
    category: buildFieldRule('c.category'),
    severity: buildFieldRule('c.severity'),
    teamId: buildFieldRule('c.team_id'),
    createdAt: buildFieldRule('c.created_at', { type: 'date' }),
    assignedTo: buildFieldRule('c.assigned_to_user_id'),
  };
}

router.get(
  '/concerns',
  asyncHandler(async (req, res) => {
    await assertPermission(req, 'concerns.review');

    const params = [];
    const filterSql = compileFilter(parseFilter(req.query.filter || ''), concernFieldMap(), params).sql;
    const search = (req.query.q || '').trim().toLowerCase();
    let searchSql = 'TRUE';

    if (search) {
      const placeholder = pushParam(params, `%${search}%`);
      searchSql = `(LOWER(c.title) LIKE ${placeholder} OR LOWER(c.summary) LIKE ${placeholder} OR LOWER(s.first_name) LIKE ${placeholder} OR LOWER(s.last_name) LIKE ${placeholder})`;
    }

    const result = await query(
      `
        SELECT
          c.id,
          c.concern_ref,
          c.student_id,
          s.first_name,
          s.last_name,
          s.year_group,
          c.title,
          c.summary,
          c.status,
          c.category,
          c.severity,
          c.urgency,
          c.confidentiality_level,
          c.created_at,
          t.name AS team_name
        FROM concerns c
        JOIN students s ON s.id = c.student_id
        LEFT JOIN teams t ON t.id = c.team_id
        WHERE c.deleted_at IS NULL
          AND s.deleted_at IS NULL
          AND ${filterSql}
          AND ${searchSql}
        ORDER BY c.created_at DESC
        LIMIT 100
      `,
      params
    );

    res.json({ concerns: result.rows, filter: req.query.filter || '' });
  })
);

router.post(
  '/concerns',
  asyncHandler(async (req, res) => {
    await assertPermission(req, 'concerns.create');
    const {
      studentId,
      teamId = null,
      category,
      severity = 'medium',
      urgency = 'standard',
      confidentialityLevel = 'summary',
      title,
      summary,
      detail = null,
    } = req.body || {};

    if (!studentId || !category || !title || !summary) {
      throw new AppError(400, 'studentId, category, title, and summary are required');
    }

    const concernRef = `CON-${Date.now()}`;
    const result = await query(
      `
        INSERT INTO concerns (
          student_id,
          concern_ref,
          team_id,
          submitted_by_user_id,
          category,
          severity,
          urgency,
          confidentiality_level,
          title,
          summary,
          detail,
          created_by,
          updated_by
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $4, $4)
        RETURNING *
      `,
      [studentId, concernRef, teamId, req.auth.userId, category, severity, urgency, confidentialityLevel, title, summary, detail]
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
          created_by
        )
        VALUES ($1, 'concerns', $2, 'concern_logged', $3, $4, $5, $6, $7, $8, $9, $4)
      `,
      [studentId, result.rows[0].id, teamId, req.auth.userId, 'summary', confidentialityLevel, title, summary, detail]
    );

    res.status(201).json({ concern: result.rows[0] });
  })
);

module.exports = router;
