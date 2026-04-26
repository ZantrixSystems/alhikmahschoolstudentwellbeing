-- Migration 011: Link notes to concerns

ALTER TABLE notes
  ADD COLUMN IF NOT EXISTS concern_id UUID REFERENCES concerns(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS notes_concern_id_idx ON notes(concern_id) WHERE concern_id IS NOT NULL;
