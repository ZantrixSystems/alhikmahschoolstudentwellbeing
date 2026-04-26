-- Migration 012: Settings-managed concern incident/action reference options
-- Removes the obsolete sanction concept and moves behaviour incident dropdown
-- validation out of Worker constants and into managed reference data.

CREATE TABLE IF NOT EXISTS reference_options (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  area_key TEXT NOT NULL,
  field_key TEXT NOT NULL,
  option_key TEXT NOT NULL,
  label TEXT NOT NULL,
  description TEXT,
  team_scope TEXT NOT NULL DEFAULT 'global',
  team_id UUID REFERENCES teams(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  is_system BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  deleted_at TIMESTAMPTZ,
  CONSTRAINT reference_options_unique UNIQUE (area_key, field_key, option_key)
);

CREATE INDEX IF NOT EXISTS reference_options_field_idx
  ON reference_options (area_key, field_key, sort_order, label)
  WHERE deleted_at IS NULL;

ALTER TABLE concerns
  ADD COLUMN IF NOT EXISTS action_taken TEXT,
  ADD COLUMN IF NOT EXISTS action_note TEXT;

ALTER TABLE concerns
  DROP CONSTRAINT IF EXISTS concerns_incident_type_check,
  DROP CONSTRAINT IF EXISTS concerns_sanction_type_check,
  DROP COLUMN IF EXISTS sanction_type,
  DROP COLUMN IF EXISTS sanction_duration;

INSERT INTO permissions (permission_key, area_key, action_key, description)
VALUES
  ('settings.reference.manage', 'settings.reference', 'manage', 'Manage dropdown reference options')
ON CONFLICT (permission_key) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id, created_by)
SELECT r.id, p.id, NULL
FROM roles r
CROSS JOIN permissions p
WHERE r.role_key = 'admin'
  AND p.permission_key = 'settings.reference.manage'
ON CONFLICT DO NOTHING;

INSERT INTO reference_options (area_key, field_key, option_key, label, sort_order, is_system)
VALUES
  ('concerns', 'incident_type', 'verbal', 'Verbal incident', 10, TRUE),
  ('concerns', 'incident_type', 'physical', 'Physical incident', 20, TRUE),
  ('concerns', 'incident_type', 'disruption', 'Classroom disruption', 30, TRUE),
  ('concerns', 'incident_type', 'bullying', 'Bullying', 40, TRUE),
  ('concerns', 'incident_type', 'online', 'Online incident', 50, TRUE),
  ('concerns', 'incident_type', 'damage', 'Damage to property', 60, TRUE),
  ('concerns', 'incident_type', 'substance', 'Substance-related concern', 70, TRUE),
  ('concerns', 'incident_type', 'other', 'Other', 80, TRUE),
  ('concerns', 'action_taken', 'parent_contacted', 'Parent contacted', 10, TRUE),
  ('concerns', 'action_taken', 'student_spoken_to', 'Student spoken to', 20, TRUE),
  ('concerns', 'action_taken', 'teacher_informed', 'Teacher informed', 30, TRUE),
  ('concerns', 'action_taken', 'pastoral_follow_up', 'Pastoral follow-up', 40, TRUE),
  ('concerns', 'action_taken', 'safeguarding_referral', 'Safeguarding referral', 50, TRUE),
  ('concerns', 'action_taken', 'behaviour_follow_up', 'Behaviour follow-up', 60, TRUE),
  ('concerns', 'action_taken', 'no_further_action', 'No further action', 70, TRUE),
  ('concerns', 'action_taken', 'other', 'Other', 80, TRUE)
ON CONFLICT (area_key, field_key, option_key) DO UPDATE
SET
  label = EXCLUDED.label,
  sort_order = EXCLUDED.sort_order,
  is_system = TRUE,
  deleted_at = NULL,
  updated_at = NOW();
