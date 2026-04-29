INSERT INTO roles (role_key, name, description, is_system, is_editable)
VALUES
  ('caseworker', 'Caseworker', 'Operational wellbeing practitioner with day-to-day casework access', TRUE, TRUE),
  ('concern_logger', 'Concern Logger', 'General staff member able to submit concerns and view students', TRUE, TRUE)
ON CONFLICT (role_key) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.permission_key = ANY(
  CASE
    WHEN r.role_key = 'caseworker' THEN ARRAY[
      'dashboard.view',
      'students.view',
      'concerns.create',
      'concerns.review',
      'meetings.create',
      'meetings.view',
      'notes.create',
      'notes.view',
      'actions.manage',
      'chronology.view',
      'radar.manage',
      'reports.view',
      'settings.view'
    ]::text[]
    WHEN r.role_key = 'concern_logger' THEN ARRAY[
      'dashboard.view',
      'students.view',
      'concerns.create',
      'meetings.view'
    ]::text[]
    ELSE ARRAY[]::text[]
  END
)
WHERE r.role_key IN ('caseworker', 'concern_logger')
ON CONFLICT DO NOTHING;

INSERT INTO user_roles (user_id, role_id)
SELECT u.id, r.id
FROM users u
JOIN roles r ON r.role_key = CASE
  WHEN u.email = 'admin@alhikmah.example.org' THEN 'admin'
  WHEN u.email IN ('pastoral.lead@alhikmah.example.org', 'sendco.lead@alhikmah.example.org', 'safeguarding.lead@alhikmah.example.org') THEN 'caseworker'
  ELSE 'concern_logger'
END
WHERE u.email IN (
  'admin@alhikmah.example.org',
  'pastoral.lead@alhikmah.example.org',
  'sendco.lead@alhikmah.example.org',
  'safeguarding.lead@alhikmah.example.org'
)
ON CONFLICT DO NOTHING;

INSERT INTO user_teams (user_id, team_id)
SELECT u.id, t.id
FROM users u
JOIN teams t ON (u.email = 'pastoral.lead@alhikmah.example.org' AND t.team_key = 'pastoral')
  OR (u.email = 'sendco.lead@alhikmah.example.org' AND t.team_key = 'sendco')
  OR (u.email = 'safeguarding.lead@alhikmah.example.org' AND t.team_key = 'safeguarding')
ON CONFLICT DO NOTHING;

INSERT INTO team_visibility_rules (source_team_id, target_team_id, content_type, visibility_level)
SELECT source_team.id, target_team.id, rule.content_type, rule.visibility_level
FROM teams source_team
JOIN teams target_team ON TRUE
JOIN (
  VALUES
    ('pastoral', 'sendco', 'meetings', 'summary'),
    ('pastoral', 'sendco', 'concerns', 'summary'),
    ('sendco', 'pastoral', 'meetings', 'summary'),
    ('sendco', 'pastoral', 'chronology', 'summary'),
    ('behaviour', 'pastoral', 'meetings', 'indicator'),
    ('behaviour', 'pastoral', 'concerns', 'summary'),
    ('safeguarding', 'pastoral', 'radar', 'indicator'),
    ('safeguarding', 'pastoral', 'meetings', 'indicator'),
    ('safeguarding', 'sendco', 'radar', 'indicator')
) AS rule(source_key, target_key, content_type, visibility_level)
  ON source_team.team_key = rule.source_key
 AND target_team.team_key = rule.target_key
ON CONFLICT (source_team_id, target_team_id, content_type) DO NOTHING;

INSERT INTO saved_filters (owner_user_id, area_key, name, filter_expression, is_shared)
SELECT u.id, 'students', 'Open concerns in Year 8', 'yearGroup==Y8;hasOpenConcern==true', TRUE
FROM users u
WHERE u.email = 'admin@alhikmah.example.org'
ON CONFLICT DO NOTHING;
