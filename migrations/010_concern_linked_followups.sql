-- Migration 010: Link follow-up actions to concerns
--
-- Adds an optional foreign key from actions to concerns so that follow-up
-- actions created in response to a concern can be associated with it.
-- The column is nullable; existing actions and actions unrelated to a
-- concern are unaffected. ON DELETE SET NULL ensures no action row is
-- lost if the parent concern is ever deleted.

ALTER TABLE actions
  ADD COLUMN IF NOT EXISTS concern_id UUID REFERENCES concerns(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS actions_concern_id_idx ON actions(concern_id) WHERE concern_id IS NOT NULL;
