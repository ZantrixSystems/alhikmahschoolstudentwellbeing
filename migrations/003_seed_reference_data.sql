INSERT INTO roles (role_key, name, description, is_system, is_editable)
VALUES ('admin', 'Admin', 'Fixed full-access administrator role', TRUE, FALSE)
ON CONFLICT (role_key) DO UPDATE
SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  is_system = TRUE,
  is_editable = FALSE,
  updated_at = NOW();

INSERT INTO permissions (permission_key, area_key, action_key, description)
VALUES
  ('dashboard.view', 'dashboard', 'view', 'View dashboard'),
  ('students.view', 'students', 'view', 'View student directory and profiles'),
  ('students.manage', 'students', 'manage', 'Manage student profile metadata'),
  ('concerns.create', 'concerns', 'create', 'Create concerns'),
  ('concerns.review', 'concerns', 'review', 'Review and update concerns'),
  ('concerns.export', 'concerns', 'export', 'Export concern views'),
  ('meetings.create', 'meetings', 'create', 'Log meetings and interactions'),
  ('meetings.view', 'meetings', 'view', 'View meetings and interactions'),
  ('notes.create', 'notes', 'create', 'Create notes'),
  ('notes.view', 'notes', 'view', 'View notes'),
  ('actions.manage', 'actions', 'manage', 'Manage actions and interventions'),
  ('chronology.view', 'chronology', 'view', 'View chronology'),
  ('radar.manage', 'radar', 'manage', 'Manage team radar states'),
  ('reports.view', 'reports', 'view', 'View reports'),
  ('settings.view', 'settings', 'view', 'View settings'),
  ('settings.users.manage', 'settings.users', 'manage', 'Manage users'),
  ('settings.roles.manage', 'settings.roles', 'manage', 'Manage roles'),
  ('settings.permissions.manage', 'settings.permissions', 'manage', 'Manage permissions'),
  ('settings.teams.manage', 'settings.teams', 'manage', 'Manage teams'),
  ('settings.visibility.manage', 'settings.visibility', 'manage', 'Manage team visibility rules'),
  ('settings.auth.manage', 'settings.auth', 'manage', 'Manage domain and sign-in settings'),
  ('audit.view', 'audit', 'view', 'View audit logs')
ON CONFLICT (permission_key) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.role_key = 'admin'
ON CONFLICT DO NOTHING;

INSERT INTO teams (team_key, name, description, accent_color)
VALUES
  ('sendco', 'SENDCO', 'Special educational needs and disability support', '#2563EB'),
  ('pastoral', 'Pastoral', 'Pastoral support and attendance-related follow-up', '#0F766E'),
  ('behaviour', 'Behaviour', 'Behaviour management and interventions', '#B45309'),
  ('safeguarding', 'Safeguarding', 'Safeguarding and child protection team', '#B91C1C')
ON CONFLICT (team_key) DO NOTHING;

INSERT INTO app_settings (key, value)
VALUES
  ('auth.allowedDomains', '["alhikmah.example.org"]'::jsonb),
  ('auth.enforceDomainRestriction', 'true'::jsonb),
  ('app.name', '"Al Hikmah Student Wellbeing"'::jsonb),
  ('app.mode', '"beta"'::jsonb),
  ('filters.enabledAreas', '["students","concerns","meetings","chronology","settings.users","settings.roles","settings.teams"]'::jsonb)
ON CONFLICT (key) DO NOTHING;
