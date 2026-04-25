-- Migration 009: Behaviour incident and sanction fields on concerns

ALTER TABLE concerns
  ADD COLUMN IF NOT EXISTS incident_type TEXT
    CHECK (incident_type IN ('verbal','physical','disruption','bullying','online','damage','substance','other')),
  ADD COLUMN IF NOT EXISTS sanction_type TEXT
    CHECK (sanction_type IN ('none','verbal_warning','detention','isolation','ftes','managed_move','permanent_exclusion')),
  ADD COLUMN IF NOT EXISTS sanction_duration TEXT,
  ADD COLUMN IF NOT EXISTS behaviour_plan_active BOOLEAN NOT NULL DEFAULT FALSE;
