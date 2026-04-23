CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE students
  ADD COLUMN IF NOT EXISTS middle_name TEXT,
  ADD COLUMN IF NOT EXISTS preferred_name TEXT,
  ADD COLUMN IF NOT EXISTS date_of_birth DATE,
  ADD COLUMN IF NOT EXISTS admission_number TEXT,
  ADD COLUMN IF NOT EXISTS form_group TEXT,
  ADD COLUMN IF NOT EXISTS key_stage TEXT,
  ADD COLUMN IF NOT EXISTS gender TEXT,
  ADD COLUMN IF NOT EXISTS pupil_premium BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS send_status TEXT,
  ADD COLUMN IF NOT EXISTS safeguarding_flag BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS attendance_concern BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS current_status TEXT NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS notes_summary TEXT,
  ADD COLUMN IF NOT EXISTS created_by UUID,
  ADD COLUMN IF NOT EXISTS updated_by UUID,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  first_name TEXT,
  last_name TEXT,
  primary_team_id UUID,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  is_admin_locked BOOLEAN NOT NULL DEFAULT FALSE,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID,
  updated_by UUID,
  deleted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role_key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  is_system BOOLEAN NOT NULL DEFAULT FALSE,
  is_editable BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID,
  updated_by UUID,
  deleted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  permission_key TEXT NOT NULL UNIQUE,
  area_key TEXT NOT NULL,
  action_key TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id UUID NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID,
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE IF NOT EXISTS user_roles (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID,
  PRIMARY KEY (user_id, role_id)
);

CREATE TABLE IF NOT EXISTS teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  accent_color TEXT NOT NULL DEFAULT '#2F6B66',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID,
  updated_by UUID,
  deleted_at TIMESTAMPTZ
);

ALTER TABLE users
  ADD CONSTRAINT users_primary_team_fk
  FOREIGN KEY (primary_team_id) REFERENCES teams(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS user_teams (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID,
  PRIMARY KEY (user_id, team_id)
);

CREATE TABLE IF NOT EXISTS team_visibility_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  target_team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  content_type TEXT NOT NULL,
  visibility_level TEXT NOT NULL CHECK (visibility_level IN ('none', 'indicator', 'summary', 'full')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID,
  updated_by UUID,
  deleted_at TIMESTAMPTZ,
  CONSTRAINT team_visibility_rule_unique UNIQUE (source_team_id, target_team_id, content_type)
);

CREATE TABLE IF NOT EXISTS student_flags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  flag_key TEXT NOT NULL,
  label TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'medium',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  visibility_level TEXT NOT NULL DEFAULT 'summary',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID,
  updated_by UUID,
  deleted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS student_team_radar (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'monitoring', 'paused', 'offboarded')),
  category TEXT,
  reason_summary TEXT NOT NULL,
  detail_note TEXT,
  severity TEXT NOT NULL DEFAULT 'medium',
  visibility_level TEXT NOT NULL DEFAULT 'summary' CHECK (visibility_level IN ('indicator', 'summary', 'full')),
  assigned_lead_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  offboarded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID,
  updated_by UUID,
  deleted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS concerns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  concern_ref TEXT NOT NULL UNIQUE,
  source_type TEXT NOT NULL DEFAULT 'staff',
  team_id UUID REFERENCES teams(id) ON DELETE SET NULL,
  submitted_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  assigned_to_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  category TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'triage', 'escalated', 'resolved', 'closed')),
  severity TEXT NOT NULL DEFAULT 'medium',
  urgency TEXT NOT NULL DEFAULT 'standard',
  confidentiality_level TEXT NOT NULL DEFAULT 'summary' CHECK (confidentiality_level IN ('summary', 'restricted', 'safeguarding')),
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  detail TEXT,
  outcome_summary TEXT,
  escalated_to_radar_id UUID REFERENCES student_team_radar(id) ON DELETE SET NULL,
  occurred_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID,
  updated_by UUID,
  deleted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS meetings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  team_id UUID REFERENCES teams(id) ON DELETE SET NULL,
  logged_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  interaction_type TEXT NOT NULL,
  visibility_level TEXT NOT NULL DEFAULT 'summary' CHECK (visibility_level IN ('indicator', 'summary', 'full')),
  confidentiality_level TEXT NOT NULL DEFAULT 'summary' CHECK (confidentiality_level IN ('summary', 'restricted', 'safeguarding')),
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  detail TEXT,
  occurred_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID,
  updated_by UUID,
  deleted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  team_id UUID REFERENCES teams(id) ON DELETE SET NULL,
  author_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  note_type TEXT NOT NULL DEFAULT 'case_note',
  visibility_level TEXT NOT NULL DEFAULT 'full' CHECK (visibility_level IN ('summary', 'restricted', 'full')),
  confidentiality_level TEXT NOT NULL DEFAULT 'restricted' CHECK (confidentiality_level IN ('summary', 'restricted', 'safeguarding')),
  summary TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID,
  updated_by UUID,
  deleted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  team_id UUID REFERENCES teams(id) ON DELETE SET NULL,
  owner_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'completed', 'cancelled')),
  priority TEXT NOT NULL DEFAULT 'medium',
  due_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID,
  updated_by UUID,
  deleted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS chronology_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  source_table TEXT NOT NULL,
  source_id UUID,
  event_type TEXT NOT NULL,
  team_id UUID REFERENCES teams(id) ON DELETE SET NULL,
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  visibility_level TEXT NOT NULL DEFAULT 'summary' CHECK (visibility_level IN ('indicator', 'summary', 'full')),
  confidentiality_level TEXT NOT NULL DEFAULT 'summary' CHECK (confidentiality_level IN ('summary', 'restricted', 'safeguarding')),
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  detail TEXT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID,
  deleted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS saved_filters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  area_key TEXT NOT NULL,
  name TEXT NOT NULL,
  filter_expression TEXT NOT NULL,
  is_shared BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID,
  updated_by UUID,
  deleted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  area_key TEXT NOT NULL,
  action_key TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID,
  student_id UUID REFERENCES students(id) ON DELETE SET NULL,
  target_team_id UUID REFERENCES teams(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS users_email_active_idx ON users (email) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS students_directory_idx ON students (last_name, first_name) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS students_year_group_idx ON students (year_group) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS radar_student_active_idx ON student_team_radar (student_id, status, team_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS concerns_student_status_idx ON concerns (student_id, status, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS meetings_student_occurred_idx ON meetings (student_id, occurred_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS actions_student_status_idx ON actions (student_id, status, due_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS chronology_student_occurred_idx ON chronology_events (student_id, occurred_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS saved_filters_owner_area_idx ON saved_filters (owner_user_id, area_key) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS audit_logs_area_created_idx ON audit_logs (area_key, created_at DESC);
