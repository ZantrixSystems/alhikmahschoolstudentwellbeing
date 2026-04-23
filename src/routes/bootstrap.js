const express = require('express');
const { query } = require('../db');
const { asyncHandler } = require('../lib/http');
const { assertDomainAllowed, assertPermission, getAppSettings, getEffectivePermissionKeys } = require('../services/authz');

const router = express.Router();

router.get(
  '/bootstrap',
  asyncHandler(async (req, res) => {
    await assertDomainAllowed(req.auth.email);
    await assertPermission(req, 'dashboard.view');

    const [teamsResult, filtersResult, settings, permissionKeys] = await Promise.all([
      query('SELECT id, team_key, name, accent_color FROM teams WHERE deleted_at IS NULL AND is_active = TRUE ORDER BY name'),
      query(
        `
          SELECT id, area_key, name, filter_expression, is_shared
          FROM saved_filters
          WHERE deleted_at IS NULL
            AND (owner_user_id = $1 OR is_shared = TRUE)
          ORDER BY area_key, name
        `,
        [req.auth.userId]
      ),
      getAppSettings(['app.name', 'app.mode', 'auth.allowedDomains', 'auth.enforceDomainRestriction']),
      req.auth.isAdmin ? Promise.resolve(['*']) : getEffectivePermissionKeys(req.auth.userId),
    ]);

    res.json({
      currentUser: { ...req.auth, permissionKeys },
      teams: teamsResult.rows,
      savedFilters: filtersResult.rows,
      settings,
      navigation: [
        { key: 'dashboard', label: 'Dashboard' },
        { key: 'students', label: 'Students' },
        { key: 'concerns', label: 'Concerns' },
        { key: 'meetings', label: 'Meetings' },
        { key: 'settings', label: 'Settings' },
      ],
    });
  })
);

module.exports = router;
