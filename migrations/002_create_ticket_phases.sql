-- up
CREATE TABLE IF NOT EXISTS ticket_phases (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id    UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  phase        TEXT NOT NULL CHECK (phase IN ('phase1', 'phase2')),
  status       TEXT NOT NULL DEFAULT 'started' CHECK (status IN ('started', 'progress', 'success', 'failure')),
  attempts     INT NOT NULL DEFAULT 0,
  output       JSON,
  started_at   TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  UNIQUE (ticket_id, phase)
);

-- down
-- DROP TABLE IF EXISTS ticket_phases;
