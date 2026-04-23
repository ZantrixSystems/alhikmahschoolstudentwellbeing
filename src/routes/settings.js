const express = require('express');
const { query } = require('../db');
const { asyncHandler, AppError } = require('../lib/http');
const { assertPermission } = require('../services/authz');
const { writeAuditLog } = require('../services/audit');

const router = express.Router();

router.get(
  '/settings/reference',
  asyncHandler(async (req, res) => {
    await assertPermission(req, 'settings.view');

    const [users, roles, permissions, teams, visibility] = await Promise.all([
      query('SELECT id, email, display_name, primary_team_id, is_active FROM users WHERE deleted_at IS NULL ORDER BY display_name'),
      query('SELECT id, role_key, name, description, is_system, is_editable FROM roles WHERE deleted_at IS NULL ORDER BY name'),
      query('SELECT id, permission_key, area_key, action_key, description FROM permissions ORDER BY permission_key'),
      query('SELECT id, team_key, name, description, accent_color, is_active FROM teams WHERE deleted_at IS NULL ORDER BY name'),
      query(
        `
          SELECT
            tvr.id,
            tvr.source_team_id,
            source_team.name AS source_team_name,
            tvr.target_team_id,
            target_team.name AS target_team_name,
            tvr.content_type,
            tvr.visibility_level
          FROM team_visibility_rules tvr
          JOIN teams source_team ON source_team.id = tvr.source_team_id
          JOIN teams target_team ON target_team.id = tvr.target_team_id
          WHERE tvr.deleted_at IS NULL
          ORDER BY source_team.name, target_team.name, tvr.content_type
        `
      ),
    ]);

    res.json({
      users: users.rows,
      roles: roles.rows,
      permissions: permissions.rows,
      teams: teams.rows,
      visibilityRules: visibility.rows,
    });
  })
);

router.get(
  '/audit-logs',
  asyncHandler(async (req, res) => {
    await assertPermission(req, 'audit.view');

    const result = await query(
      `
        SELECT
          a.id,
          a.area_key,
          a.action_key,
          a.entity_type,
          a.created_at,
          u.display_name AS actor_name,
          s.student_code,
          s.first_name,
          s.last_name
        FROM audit_logs a
        LEFT JOIN users u ON u.id = a.actor_user_id
        LEFT JOIN students s ON s.id = a.student_id
        ORDER BY a.created_at DESC
        LIMIT 100
      `
    );

    res.json({ auditLogs: result.rows });
  })
);

router.post(
  '/settings/roles',
  asyncHandler(async (req, res) => {
    await assertPermission(req, 'settings.roles.manage');
    const { roleKey, name, description = '', permissionKeys = [] } = req.body || {};

    if (!roleKey || !name) {
      throw new AppError(400, 'roleKey and name are required');
    }

    const roleResult = await query(
      `
        INSERT INTO roles (role_key, name, description, is_system, is_editable, created_by, updated_by)
        VALUES ($1, $2, $3, FALSE, TRUE, $4, $4)
        ON CONFLICT (role_key) DO UPDATE
        SET name = EXCLUDED.name,
            description = EXCLUDED.description,
            updated_at = NOW(),
            updated_by = EXCLUDED.updated_by
        RETURNING *
      `,
      [roleKey, name, description, req.auth.userId]
    );

    await query('DELETE FROM role_permissions WHERE role_id = $1', [roleResult.rows[0].id]);
    if (permissionKeys.length) {
      await query(
        `
          INSERT INTO role_permissions (role_id, permission_id, created_by)
          SELECT $1, p.id, $2
          FROM permissions p
          WHERE p.permission_key = ANY($3::text[])
        `,
        [roleResult.rows[0].id, req.auth.userId, permissionKeys]
      );
    }

    await writeAuditLog(req.auth, {
      areaKey: 'settings.roles',
      actionKey: 'upsert',
      entityType: 'role',
      entityId: roleResult.rows[0].id,
      metadata: { roleKey, permissionKeys },
    });

    res.status(201).json({ role: roleResult.rows[0] });
  })
);

router.post(
  '/settings/teams',
  asyncHandler(async (req, res) => {
    await assertPermission(req, 'settings.teams.manage');
    const { teamKey, name, description = '', accentColor = '#2F6B66', isActive = true } = req.body || {};

    if (!teamKey || !name) {
      throw new AppError(400, 'teamKey and name are required');
    }

    const result = await query(
      `
        INSERT INTO teams (team_key, name, description, accent_color, is_active, created_by, updated_by)
        VALUES ($1, $2, $3, $4, $5, $6, $6)
        ON CONFLICT (team_key) DO UPDATE
        SET name = EXCLUDED.name,
            description = EXCLUDED.description,
            accent_color = EXCLUDED.accent_color,
            is_active = EXCLUDED.is_active,
            updated_at = NOW(),
            updated_by = EXCLUDED.updated_by
        RETURNING *
      `,
      [teamKey, name, description, accentColor, isActive, req.auth.userId]
    );

    res.status(201).json({ team: result.rows[0] });
  })
);

router.post(
  '/settings/visibility-rules',
  asyncHandler(async (req, res) => {
    await assertPermission(req, 'settings.visibility.manage');
    const { sourceTeamId, targetTeamId, contentType, visibilityLevel } = req.body || {};

    if (!sourceTeamId || !targetTeamId || !contentType || !visibilityLevel) {
      throw new AppError(400, 'sourceTeamId, targetTeamId, contentType, and visibilityLevel are required');
    }

    const result = await query(
      `
        INSERT INTO team_visibility_rules (
          source_team_id,
          target_team_id,
          content_type,
          visibility_level,
          created_by,
          updated_by
        )
        VALUES ($1, $2, $3, $4, $5, $5)
        ON CONFLICT (source_team_id, target_team_id, content_type)
        DO UPDATE SET visibility_level = EXCLUDED.visibility_level, updated_at = NOW(), updated_by = EXCLUDED.updated_by
        RETURNING *
      `,
      [sourceTeamId, targetTeamId, contentType, visibilityLevel, req.auth.userId]
    );

    await writeAuditLog(req.auth, {
      areaKey: 'settings.visibility',
      actionKey: 'upsert',
      entityType: 'team_visibility_rule',
      entityId: result.rows[0].id,
      targetTeamId,
      metadata: { sourceTeamId, contentType, visibilityLevel },
    });

    res.status(201).json({ visibilityRule: result.rows[0] });
  })
);

router.post(
  '/settings/users',
  asyncHandler(async (req, res) => {
    await assertPermission(req, 'settings.users.manage');
    const { email, displayName, primaryTeamId = null, roleKeys = [], isActive = true } = req.body || {};

    if (!email || !displayName) {
      throw new AppError(400, 'email and displayName are required');
    }

    const userResult = await query(
      `
        INSERT INTO users (email, display_name, primary_team_id, is_active, created_by, updated_by)
        VALUES ($1, $2, $3, $4, $5, $5)
        ON CONFLICT (email) DO UPDATE
        SET display_name = EXCLUDED.display_name,
            primary_team_id = EXCLUDED.primary_team_id,
            is_active = EXCLUDED.is_active,
            updated_at = NOW(),
            updated_by = EXCLUDED.updated_by
        RETURNING *
      `,
      [email.toLowerCase(), displayName, primaryTeamId, isActive, req.auth.userId]
    );

    await query('DELETE FROM user_roles WHERE user_id = $1 AND role_id <> (SELECT id FROM roles WHERE role_key = $2)', [userResult.rows[0].id, 'admin']);
    if (roleKeys.length) {
      await query(
        `
          INSERT INTO user_roles (user_id, role_id, created_by)
          SELECT $1, r.id, $2
          FROM roles r
          WHERE r.role_key = ANY($3::text[])
        `,
        [userResult.rows[0].id, req.auth.userId, roleKeys]
      );
    }

    res.status(201).json({ user: userResult.rows[0] });
  })
);

module.exports = router;
