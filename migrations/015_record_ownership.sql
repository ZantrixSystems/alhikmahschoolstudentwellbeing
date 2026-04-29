-- Migration 015: Add owner_team_id to record tables for edit ownership enforcement.
--
-- The owner_team_id is set at creation time to the first team associated with the
-- record. It identifies which team
-- "owns" the record for edit-permission purposes. Cross-team visibility and
-- collaboration are unchanged — this only controls who can EDIT a record.
--
-- Backfill: for existing records, derive owner_team_id from the junction tables
-- where possible, otherwise leave NULL (which makes the record editable only by
-- admins until re-assigned).

-- concerns
ALTER TABLE concerns ADD COLUMN IF NOT EXISTS owner_team_id UUID REFERENCES teams(id) ON DELETE SET NULL;
UPDATE concerns c
SET owner_team_id = (
  SELECT ct.team_id FROM concern_teams ct
  WHERE ct.concern_id = c.id
  ORDER BY ct.team_id
  LIMIT 1
)
WHERE c.owner_team_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_concerns_owner_team ON concerns (owner_team_id) WHERE deleted_at IS NULL;

-- meetings
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS owner_team_id UUID REFERENCES teams(id) ON DELETE SET NULL;
UPDATE meetings m
SET owner_team_id = (
  SELECT mt.team_id FROM meeting_teams mt
  WHERE mt.meeting_id = m.id
  ORDER BY mt.team_id
  LIMIT 1
)
WHERE m.owner_team_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_meetings_owner_team ON meetings (owner_team_id) WHERE deleted_at IS NULL;

-- notes
ALTER TABLE notes ADD COLUMN IF NOT EXISTS owner_team_id UUID REFERENCES teams(id) ON DELETE SET NULL;
UPDATE notes n
SET owner_team_id = (
  SELECT nt.team_id FROM note_teams nt
  WHERE nt.note_id = n.id
  ORDER BY nt.team_id
  LIMIT 1
)
WHERE n.owner_team_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_notes_owner_team ON notes (owner_team_id) WHERE deleted_at IS NULL;

-- actions / follow-ups
ALTER TABLE actions ADD COLUMN IF NOT EXISTS owner_team_id UUID REFERENCES teams(id) ON DELETE SET NULL;
UPDATE actions a
SET owner_team_id = (
  SELECT at2.team_id FROM action_teams at2
  WHERE at2.action_id = a.id
  ORDER BY at2.team_id
  LIMIT 1
)
WHERE a.owner_team_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_actions_owner_team ON actions (owner_team_id) WHERE deleted_at IS NULL;
