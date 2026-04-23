const express = require('express');
const { query } = require('../db');
const { asyncHandler } = require('../lib/http');
const { assertPermission } = require('../services/authz');

const router = express.Router();

router.get(
  '/dashboard',
  asyncHandler(async (req, res) => {
    await assertPermission(req, 'dashboard.view');

    const [headlineCounts, teamLoad] = await Promise.all([
      query(
        `
          SELECT
            (SELECT COUNT(*) FROM students WHERE deleted_at IS NULL) AS student_count,
            (SELECT COUNT(*) FROM concerns WHERE deleted_at IS NULL AND status IN ('open', 'triage', 'escalated')) AS open_concern_count,
            (SELECT COUNT(*) FROM student_team_radar WHERE deleted_at IS NULL AND status IN ('active', 'monitoring')) AS active_radar_count,
            (SELECT COUNT(*) FROM actions WHERE deleted_at IS NULL AND status IN ('open', 'in_progress')) AS open_action_count
        `
      ),
      query(
        `
          SELECT t.id, t.name, t.team_key, t.accent_color, COUNT(r.id)::int AS active_students
          FROM teams t
          LEFT JOIN student_team_radar r
            ON r.team_id = t.id
           AND r.deleted_at IS NULL
           AND r.status IN ('active', 'monitoring')
          WHERE t.deleted_at IS NULL
          GROUP BY t.id
          ORDER BY t.name
        `
      ),
    ]);

    res.json({
      headline: headlineCounts.rows[0],
      teamLoad: teamLoad.rows,
    });
  })
);

module.exports = router;
