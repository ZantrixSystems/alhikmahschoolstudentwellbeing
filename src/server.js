require('dotenv').config({ path: '.env.local' });

const express = require('express');
const { query } = require('./db');

const app = express();
const port = Number(process.env.API_PORT || 3000);

app.use(express.json());

function requireApiToken(req, res, next) {
  const expectedToken = process.env.APPS_SCRIPT_API_TOKEN;
  const providedToken = req.header('x-api-token');

  if (!expectedToken) {
    return res.status(500).json({ error: 'Server token is not configured.' });
  }

  if (providedToken !== expectedToken) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  return next();
}

app.get('/health', async (_req, res) => {
  const result = await query('SELECT NOW() AS server_time');
  res.json({
    ok: true,
    serverTime: result.rows[0].server_time,
  });
});

app.get('/api/students', requireApiToken, async (_req, res) => {
  const result = await query(`
    SELECT id, student_code, first_name, last_name, year_group, tutor_group, created_at
    FROM students
    ORDER BY last_name, first_name
  `);

  res.json({ students: result.rows });
});

app.post('/api/wellbeing-entries', requireApiToken, async (req, res) => {
  const {
    studentId,
    score,
    notes = null,
    recordedByEmail = null,
    recordedAt = null,
  } = req.body || {};

  if (!studentId || !Number.isInteger(score) || score < 1 || score > 5) {
    return res.status(400).json({
      error: 'studentId and score (1-5 integer) are required.',
    });
  }

  const result = await query(
    `
      INSERT INTO wellbeing_entries (
        student_id,
        score,
        notes,
        recorded_by_email,
        recorded_at
      )
      VALUES (
        $1,
        $2,
        $3,
        $4,
        COALESCE($5::timestamptz, NOW())
      )
      RETURNING id, student_id, score, notes, recorded_by_email, recorded_at, created_at
    `,
    [studentId, score, notes, recordedByEmail, recordedAt]
  );

  return res.status(201).json({ entry: result.rows[0] });
});

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(port, () => {
  console.log(`API listening on http://localhost:${port}`);
});

