const crypto = require('crypto');
const { queryOne } = require('../db');
const config = require('../config');
const { AppError } = require('../lib/http');

function buildExpectedSignature(req, rawBody) {
  const timestamp = req.header('x-request-timestamp') || '';
  const method = req.method.toUpperCase();
  const path = req.originalUrl.split('?')[0];
  const body = rawBody || '';
  return crypto
    .createHmac('sha256', config.signingSecret)
    .update([timestamp, method, path, body].join('\n'))
    .digest('hex');
}

async function resolveUser(email) {
  return queryOne(
    `
      SELECT
        u.id,
        u.email,
        u.display_name,
        u.primary_team_id,
        u.is_active,
        COALESCE(
          ARRAY_AGG(DISTINCT r.role_key) FILTER (WHERE r.role_key IS NOT NULL),
          ARRAY[]::text[]
        ) AS role_keys,
        COALESCE(
          ARRAY_AGG(DISTINCT ut.team_id) FILTER (WHERE ut.team_id IS NOT NULL),
          ARRAY[]::uuid[]
        ) AS team_ids
      FROM users u
      LEFT JOIN user_roles ur ON ur.user_id = u.id
      LEFT JOIN roles r ON r.id = ur.role_id AND r.deleted_at IS NULL
      LEFT JOIN user_teams ut ON ut.user_id = u.id
      WHERE LOWER(u.email) = LOWER($1)
        AND u.deleted_at IS NULL
      GROUP BY u.id
    `,
    [email]
  );
}

async function requireAppAuth(req, _res, next) {
  try {
    if (!config.apiToken || !config.signingSecret) {
      throw new AppError(500, 'Server authentication configuration is incomplete');
    }

    const token = req.header('x-api-token');
    if (token !== config.apiToken) {
      throw new AppError(401, 'Unauthorized');
    }

    const timestamp = Number(req.header('x-request-timestamp'));
    if (!timestamp || Math.abs(Date.now() - timestamp) > config.requestTtlMs) {
      throw new AppError(401, 'Request signature expired');
    }

    const signature = req.header('x-request-signature');
    const expectedSignature = buildExpectedSignature(req, req.rawBody || '');
    if (
      !signature ||
      signature.length !== expectedSignature.length ||
      !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))
    ) {
      throw new AppError(401, 'Invalid request signature');
    }

    const email = (req.header('x-app-user-email') || '').trim().toLowerCase();
    if (!email) {
      throw new AppError(401, 'Missing asserted user email');
    }

    const user = await resolveUser(email);
    if (!user || !user.is_active) {
      throw new AppError(403, 'User is not authorised for this app');
    }

    req.auth = {
      userId: user.id,
      email: user.email,
      displayName: user.display_name,
      roleKeys: user.role_keys,
      teamIds: [...new Set([user.primary_team_id, ...user.team_ids].filter(Boolean))],
      isAdmin: user.role_keys.includes('admin'),
    };

    return next();
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  requireAppAuth,
};
