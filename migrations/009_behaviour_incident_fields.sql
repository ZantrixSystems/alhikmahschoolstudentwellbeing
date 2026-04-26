-- Migration 009: Behaviour incident fields on concerns

ALTER TABLE concerns
  ADD COLUMN IF NOT EXISTS incident_type TEXT,
  ADD COLUMN IF NOT EXISTS behaviour_plan_active BOOLEAN NOT NULL DEFAULT FALSE;
