const { query, queryOne } = require('../db');
const { AppError } = require('../lib/http');

async function getAppSettings(keys) {
  const result = await query(
    'SELECT key, value FROM app_settings WHERE key = ANY($1::text[])',
    [keys]
  );

  return result.rows.reduce((acc, row) => {
    acc[row.key] = row.value;
    return acc;
  }, {});
}

async function assertDomainAllowed(email) {
  const settings = await getAppSettings(['auth.allowedDomains', 'auth.enforceDomainRestriction']);
  const enforce = settings['auth.enforceDomainRestriction'] === true;
  if (!enforce) {
    return;
  }

  const allowedDomains = settings['auth.allowedDomains'] || [];
  const domain = String(email || '').split('@')[1] || '';
  if (!allowedDomains.includes(domain)) {
    throw new AppError(403, 'Domain is not allowed for this app');
  }
}

async function assertPermission(req, permissionKey) {
  if (req.auth.isAdmin) {
    return;
  }

  const result = await queryOne(
    `
      SELECT 1
      FROM user_roles ur
      JOIN role_permissions rp ON rp.role_id = ur.role_id
      JOIN permissions p ON p.id = rp.permission_id
      WHERE ur.user_id = $1
        AND p.permission_key = $2
      LIMIT 1
    `,
    [req.auth.userId, permissionKey]
  );

  if (!result) {
    throw new AppError(403, `Missing permission: ${permissionKey}`);
  }
}

async function getEffectivePermissionKeys(userId) {
  const result = await query(
    `
      SELECT DISTINCT p.permission_key
      FROM user_roles ur
      JOIN role_permissions rp ON rp.role_id = ur.role_id
      JOIN permissions p ON p.id = rp.permission_id
      WHERE ur.user_id = $1
      ORDER BY p.permission_key
    `,
    [userId]
  );

  return result.rows.map((row) => row.permission_key);
}

module.exports = {
  assertDomainAllowed,
  assertPermission,
  getEffectivePermissionKeys,
  getAppSettings,
};
