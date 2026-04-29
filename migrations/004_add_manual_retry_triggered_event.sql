-- up
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
  'manual_retry_triggered'
));

-- down
-- ALTER TABLE ticket_events
-- DROP CONSTRAINT IF EXISTS ticket_events_event_type_check;
