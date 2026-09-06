/** Fan-out (one delivery per subscriber): composed into event insert for atomicity. */
export const fanOutClause = (eventCte: string): string =>
  `INSERT INTO pipeline.event_deliveries (event_id, subscriber, event_name, visibility_timeout_seconds)
     SELECT e.id, s.subscriber, e.event_name, s.visibility_timeout_seconds
       FROM ${eventCte} e
       JOIN pipeline.event_subscriptions s ON s.event_name = e.event_name
     ON CONFLICT (event_id, subscriber) DO NOTHING`;
