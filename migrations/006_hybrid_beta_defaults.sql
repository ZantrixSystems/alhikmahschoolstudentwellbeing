UPDATE teams
SET
  name = 'SENDCO / SEN',
  description = 'Special educational needs and SEND coordination radar'
WHERE team_key = 'sendco';

UPDATE teams
SET
  name = 'Behaviour Management',
  description = 'Behaviour management and intervention radar'
WHERE team_key = 'behaviour';

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.permission_key = 'students.manage'
WHERE r.role_key = 'caseworker'
ON CONFLICT DO NOTHING;

INSERT INTO app_settings (key, value)
VALUES
  ('architecture.runtime', '"apps-script-worker-neon"'::jsonb),
  ('radar.defaultTeamKeys', '["safeguarding","sendco","pastoral","behaviour"]'::jsonb)
ON CONFLICT (key) DO UPDATE
SET value = EXCLUDED.value, updated_at = NOW();
