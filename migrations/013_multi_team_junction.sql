-- Migration 013: Replace single team_id with junction tables on notes, meetings, concerns, actions.
-- Each record can now be visible to multiple teams simultaneously.

-- NOTES
CREATE TABLE IF NOT EXISTS note_teams (
  note_id  UUID NOT NULL REFERENCES notes(id)  ON DELETE CASCADE,
  team_id  UUID NOT NULL REFERENCES teams(id)  ON DELETE CASCADE,
  PRIMARY KEY (note_id, team_id)
);
CREATE INDEX IF NOT EXISTS note_teams_team_id_idx ON note_teams (team_id);

INSERT INTO note_teams (note_id, team_id)
SELECT id, team_id FROM notes WHERE team_id IS NOT NULL AND deleted_at IS NULL
ON CONFLICT DO NOTHING;

ALTER TABLE notes DROP COLUMN IF EXISTS team_id;

-- MEETINGS
CREATE TABLE IF NOT EXISTS meeting_teams (
  meeting_id  UUID NOT NULL REFERENCES meetings(id)  ON DELETE CASCADE,
  team_id     UUID NOT NULL REFERENCES teams(id)      ON DELETE CASCADE,
  PRIMARY KEY (meeting_id, team_id)
);
CREATE INDEX IF NOT EXISTS meeting_teams_team_id_idx ON meeting_teams (team_id);

INSERT INTO meeting_teams (meeting_id, team_id)
SELECT id, team_id FROM meetings WHERE team_id IS NOT NULL AND deleted_at IS NULL
ON CONFLICT DO NOTHING;

ALTER TABLE meetings DROP COLUMN IF EXISTS team_id;

-- CONCERNS
CREATE TABLE IF NOT EXISTS concern_teams (
  concern_id  UUID NOT NULL REFERENCES concerns(id)  ON DELETE CASCADE,
  team_id     UUID NOT NULL REFERENCES teams(id)      ON DELETE CASCADE,
  PRIMARY KEY (concern_id, team_id)
);
CREATE INDEX IF NOT EXISTS concern_teams_team_id_idx ON concern_teams (team_id);

INSERT INTO concern_teams (concern_id, team_id)
SELECT id, team_id FROM concerns WHERE team_id IS NOT NULL AND deleted_at IS NULL
ON CONFLICT DO NOTHING;

ALTER TABLE concerns DROP COLUMN IF EXISTS team_id;

-- ACTIONS
CREATE TABLE IF NOT EXISTS action_teams (
  action_id  UUID NOT NULL REFERENCES actions(id)  ON DELETE CASCADE,
  team_id    UUID NOT NULL REFERENCES teams(id)    ON DELETE CASCADE,
  PRIMARY KEY (action_id, team_id)
);
CREATE INDEX IF NOT EXISTS action_teams_team_id_idx ON action_teams (team_id);

INSERT INTO action_teams (action_id, team_id)
SELECT id, team_id FROM actions WHERE team_id IS NOT NULL AND deleted_at IS NULL
ON CONFLICT DO NOTHING;

ALTER TABLE actions DROP COLUMN IF EXISTS team_id;
