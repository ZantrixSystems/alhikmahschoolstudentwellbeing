require('dotenv').config({ path: '.env.local' });

const express = require('express');
const { query } = require('./db');
const config = require('./config');
const { AppError } = require('./lib/http');
const { requireAppAuth } = require('./middleware/auth');

const bootstrapRoutes = require('./routes/bootstrap');
const dashboardRoutes = require('./routes/dashboard');
const studentRoutes = require('./routes/students');
const concernRoutes = require('./routes/concerns');
const meetingRoutes = require('./routes/meetings');
const settingsRoutes = require('./routes/settings');

const app = express();

app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf.toString('utf8');
    },
  })
);

app.get('/health', async (_req, res) => {
  const result = await query('SELECT NOW() AS server_time');
  res.json({
    ok: true,
    serverTime: result.rows[0].server_time,
  });
});

app.use('/api', requireAppAuth, bootstrapRoutes, dashboardRoutes, studentRoutes, concernRoutes, meetingRoutes, settingsRoutes);

app.use((req, _res, next) => {
  next(new AppError(404, `Route not found: ${req.path}`));
});

app.use((error, _req, res, _next) => {
  const statusCode = error.statusCode || 500;
  const payload = {
    error: error.message || 'Internal server error',
  };

  if (error.details) {
    payload.details = error.details;
  }

  if (statusCode >= 500) {
    console.error(error);
  }

  res.status(statusCode).json(payload);
});

app.listen(config.port, () => {
  console.log(`API listening on http://localhost:${config.port}`);
});
