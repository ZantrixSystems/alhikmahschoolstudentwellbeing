-- Migration 008: Ofsted readiness additions
-- Adds concern closure flow, referral tracking, SEND plan model,
-- external agency fields on meetings, and chronology enrichment.

-- ============================================================
-- 1. Extend concerns: closure + referral tracking
-- ============================================================

ALTER TABLE concerns
  ADD COLUMN IF NOT EXISTS referral_type TEXT
    CHECK (referral_type IN ('none','mash','lado','police','early_help','camhs','social_care','other')),
  ADD COLUMN IF NOT EXISTS referral_date DATE,
  ADD COLUMN IF NOT EXISTS referral_outcome TEXT,
  ADD COLUMN IF NOT EXISTS escalation_log JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS closed_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;

-- outcome_summary already exists on concerns from migration 002.
-- Ensure it's present on any older schema that may have missed it.
ALTER TABLE concerns
  ADD COLUMN IF NOT EXISTS outcome_summary TEXT;

-- ============================================================
-- 2. Extend students: SEND category
-- ============================================================

ALTER TABLE students
  ADD COLUMN IF NOT EXISTS send_category TEXT NOT NULL DEFAULT 'none'
    CHECK (send_category IN ('none','sen_support','ehcp','assessed_no_need'));

-- Migrate existing send_status boolean → send_category where possible.
-- send_status = true → 'sen_support' (conservative default; staff can revise).
UPDATE students
  SET send_category = 'sen_support'
  WHERE send_status IS NOT NULL
    AND send_status::text = 'true'
    AND send_category = 'none';

-- ============================================================
-- 3. SEND plans table
-- ============================================================

CREATE TABLE IF NOT EXISTS send_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  plan_type TEXT NOT NULL
    CHECK (plan_type IN ('sen_support','ehcp','early_help')),
  plan_ref TEXT,
  ehcp_annual_review_date DATE,
  identified_needs TEXT,
  planned_provision TEXT,
  review_date DATE,
  review_outcome TEXT,
  external_agency TEXT,
  specialist_name TEXT,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','under_review','closed')),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS send_plans_student_idx
  ON send_plans (student_id, status)
  WHERE deleted_at IS NULL;

-- ============================================================
-- 4. Extend meetings: external agency fields
-- ============================================================

ALTER TABLE meetings
  ADD COLUMN IF NOT EXISTS external_agency TEXT,
  ADD COLUMN IF NOT EXISTS external_contact_name TEXT,
  ADD COLUMN IF NOT EXISTS external_ref TEXT;

-- ============================================================
-- 5. Extend chronology_events: action + outcome fields
-- ============================================================

ALTER TABLE chronology_events
  ADD COLUMN IF NOT EXISTS action_taken TEXT,
  ADD COLUMN IF NOT EXISTS outcome TEXT,
  ADD COLUMN IF NOT EXISTS next_step TEXT,
  ADD COLUMN IF NOT EXISTS next_step_owner_id UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS next_step_due DATE;

-- ============================================================
-- 6. New permissions
-- ============================================================

INSERT INTO permissions (permission_key, area_key, action_key, description)
VALUES
  ('send.manage',       'send',       'manage',  'Create and update SEND plans'),
  ('referrals.manage',  'concerns',   'manage',  'Record and manage safeguarding referrals'),
  ('concerns.close',    'concerns',   'close',   'Close a concern with a mandatory outcome')
ON CONFLICT (permission_key) DO NOTHING;

-- Grant new permissions to caseworker role
INSERT INTO role_permissions (role_id, permission_id, created_by)
SELECT r.id, p.id, NULL
FROM roles r
CROSS JOIN permissions p
WHERE r.role_key = 'caseworker'
  AND p.permission_key IN ('send.manage', 'referrals.manage', 'concerns.close')
ON CONFLICT DO NOTHING;

-- ============================================================
-- 7. Settings flag
-- ============================================================

INSERT INTO app_settings (key, value)
VALUES ('ofsted.readinessFeatures', '"enabled"')
ON CONFLICT (key) DO UPDATE SET value = '"enabled"', updated_at = NOW();
