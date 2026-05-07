-- up
ALTER TABLE ticket_events
ALTER COLUMN phase DROP NOT NULL;

ALTER TABLE ticket_events
DROP CONSTRAINT IF EXISTS ticket_events_event_type_check;

ALTER TABLE ticket_events
ADD CONSTRAINT ticket_events_event_type_check
CHECK (event_type IN (
  'phase_started',
  'phase_completed',
  'phase_failed',
  'retry_scheduled',
  'fallback_triggered',
  'dlq_routed',
  'dlq_send_failed',
  'manual_retry_triggered',
  'enqueue_failed'
));

-- down
-- UPDATE ticket_events SET phase = 'phase1' WHERE phase IS NULL;
-- ALTER TABLE ticket_events ALTER COLUMN phase SET NOT NULL;
-- ALTER TABLE ticket_events DROP CONSTRAINT IF EXISTS ticket_events_event_type_check;
-- ALTER TABLE ticket_events ADD CONSTRAINT ticket_events_event_type_check
-- CHECK (event_type IN (
--   'phase_started','phase_completed','phase_failed','retry_scheduled',
--   'fallback_triggered','dlq_routed','manual_retry_triggered'
-- ));
