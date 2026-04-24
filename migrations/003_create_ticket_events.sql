-- up
CREATE TABLE IF NOT EXISTS ticket_events (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id  UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  phase      TEXT NOT NULL CHECK (phase IN ('phase1', 'phase2')),
  event_type TEXT NOT NULL CHECK (event_type IN ('phase_started', 'phase_completed', 'phase_failed', 'retry_scheduled', 'fallback_triggered', 'dlq_routed')),
  payload    JSON,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- down
-- DROP TABLE IF EXISTS ticket_events;
