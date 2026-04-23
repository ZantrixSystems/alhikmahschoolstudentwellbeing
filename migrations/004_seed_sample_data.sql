WITH team_rows AS (
  SELECT id, team_key FROM teams
),
admin_role AS (
  SELECT id FROM roles WHERE role_key = 'admin'
),
seed_users AS (
  INSERT INTO users (email, display_name, first_name, last_name, is_active)
  VALUES
    ('admin@alhikmah.example.org', 'Amina Rahman', 'Amina', 'Rahman', TRUE),
    ('pastoral.lead@alhikmah.example.org', 'Yusuf Khan', 'Yusuf', 'Khan', TRUE),
    ('sendco.lead@alhikmah.example.org', 'Mariam Ali', 'Mariam', 'Ali', TRUE),
    ('safeguarding.lead@alhikmah.example.org', 'Huda Osman', 'Huda', 'Osman', TRUE)
  ON CONFLICT (email) DO UPDATE SET display_name = EXCLUDED.display_name
  RETURNING id, email
),
assign_admin AS (
  INSERT INTO user_roles (user_id, role_id)
  SELECT u.id, r.id
  FROM seed_users u
  CROSS JOIN admin_role r
  WHERE u.email = 'admin@alhikmah.example.org'
  ON CONFLICT DO NOTHING
)
INSERT INTO students (
  student_code,
  first_name,
  last_name,
  preferred_name,
  year_group,
  tutor_group,
  form_group,
  key_stage,
  current_status,
  safeguarding_flag,
  attendance_concern,
  notes_summary
)
VALUES
  ('STU-1001', 'Aisha', 'Begum', 'Aisha', 'Y8', '8A', '8A', 'KS3', 'active', FALSE, TRUE, 'Attendance has dipped over the last half term.'),
  ('STU-1002', 'Ibrahim', 'Hussain', 'Ibrahim', 'Y10', '10C', '10C', 'KS4', 'active', TRUE, FALSE, 'Safeguarding team monitoring external agency contact.'),
  ('STU-1003', 'Sumayyah', 'Patel', 'Sumayyah', 'Y7', '7B', '7B', 'KS3', 'active', FALSE, FALSE, 'Transition support and SEND review ongoing.')
ON CONFLICT (student_code) DO NOTHING;

INSERT INTO student_team_radar (
  student_id,
  team_id,
  status,
  category,
  reason_summary,
  severity,
  visibility_level
)
SELECT s.id, t.id, 'active', 'attendance', 'Attendance trend under review', 'medium', 'summary'
FROM students s
JOIN teams t ON t.team_key = 'pastoral'
WHERE s.student_code = 'STU-1001'
ON CONFLICT DO NOTHING;

INSERT INTO student_team_radar (
  student_id,
  team_id,
  status,
  category,
  reason_summary,
  severity,
  visibility_level
)
SELECT s.id, t.id, 'active', 'safeguarding', 'External agency contact open', 'high', 'full'
FROM students s
JOIN teams t ON t.team_key = 'safeguarding'
WHERE s.student_code = 'STU-1002'
ON CONFLICT DO NOTHING;

INSERT INTO student_team_radar (
  student_id,
  team_id,
  status,
  category,
  reason_summary,
  severity,
  visibility_level
)
SELECT s.id, t.id, 'monitoring', 'send', 'SEND review follow-up in progress', 'medium', 'summary'
FROM students s
JOIN teams t ON t.team_key = 'sendco'
WHERE s.student_code = 'STU-1003'
ON CONFLICT DO NOTHING;

INSERT INTO concerns (
  student_id,
  concern_ref,
  category,
  status,
  severity,
  urgency,
  confidentiality_level,
  title,
  summary
)
SELECT s.id, 'CON-1001', 'attendance', 'open', 'medium', 'standard', 'summary', 'Attendance concern raised', 'Form tutor flagged repeated late arrivals.'
FROM students s
WHERE s.student_code = 'STU-1001'
ON CONFLICT (concern_ref) DO NOTHING;

INSERT INTO meetings (
  student_id,
  team_id,
  interaction_type,
  visibility_level,
  confidentiality_level,
  title,
  summary,
  detail,
  occurred_at
)
SELECT s.id, t.id, 'student_check_in', 'summary', 'summary', 'Pastoral check-in', 'Brief pastoral check-in completed after tutor referral.', 'Student engaged well and agreed next review date.', NOW() - INTERVAL '2 days'
FROM students s
JOIN teams t ON t.team_key = 'pastoral'
WHERE s.student_code = 'STU-1001'
ON CONFLICT DO NOTHING;

INSERT INTO chronology_events (
  student_id,
  source_table,
  event_type,
  team_id,
  visibility_level,
  confidentiality_level,
  title,
  summary,
  occurred_at
)
SELECT s.id, 'concerns', 'concern_logged', t.id, 'summary', 'summary', 'Concern logged', 'Attendance concern logged for triage.', NOW() - INTERVAL '3 days'
FROM students s
LEFT JOIN teams t ON t.team_key = 'pastoral'
WHERE s.student_code = 'STU-1001'
ON CONFLICT DO NOTHING;

INSERT INTO chronology_events (
  student_id,
  source_table,
  event_type,
  team_id,
  visibility_level,
  confidentiality_level,
  title,
  summary,
  occurred_at
)
SELECT s.id, 'student_team_radar', 'team_onboarded', t.id, 'indicator', 'restricted', 'Safeguarding involvement', 'Safeguarding team currently engaged.', NOW() - INTERVAL '5 days'
FROM students s
LEFT JOIN teams t ON t.team_key = 'safeguarding'
WHERE s.student_code = 'STU-1002'
ON CONFLICT DO NOTHING;
