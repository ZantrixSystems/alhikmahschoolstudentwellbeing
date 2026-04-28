-- Migration 014: Add indexes for visibility rule lookups and audit log queries.
-- These support the hot-path visibility computation (computeVisibility) and
-- compliance audit queries introduced alongside the security hardening changes.

-- Visibility rule lookup: used on every profile/meeting/concern fetch
CREATE INDEX IF NOT EXISTS idx_team_visibility_rules_lookup
  ON team_visibility_rules (source_team_id, target_team_id, content_type)
  WHERE deleted_at IS NULL;

-- Audit log queries by actor (compliance: "what did user X do?")
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor
  ON audit_logs (actor_user_id, created_at DESC);

-- Audit log queries by student (compliance: "who accessed student X?")
CREATE INDEX IF NOT EXISTS idx_audit_logs_student
  ON audit_logs (student_id, created_at DESC)
  WHERE student_id IS NOT NULL;

-- Audit log queries by area (filtering by domain, e.g. 'concerns', 'auth')
CREATE INDEX IF NOT EXISTS idx_audit_logs_area
  ON audit_logs (area_key, created_at DESC);
