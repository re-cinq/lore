/**
 * Fan-out: one `pipeline.event_deliveries` row per subscriber of an event.
 *
 * Composed into the SAME statement as the event insert rather than run after it,
 * because two writers insert an event inside a CTE alongside the row that event
 * names (`assembly-runs-pg`'s start and fork-rerun) and must stay atomic — a run
 * row with no start event never runs. Fan-out in the event-router's handler would
 * leave those events with no deliveries and stop every assembly line silently.
 *
 * A database trigger would make this unforgettable, and was rejected: the schema
 * is pure DDL, so a trigger would be the first stored procedure in the system —
 * untestable here, invisible to TypeScript, and revisable only through an
 * append-only migration runner where editing an applied file is inert. The
 * forgettability is closed in CI instead (see fan-out-writers.test.ts).
 */

/**
 * The clause, reading the event CTE named by `eventCte`, which must expose
 * `id` and `event_name`.
 *
 * A deduplicated insert (`ON CONFLICT (dedupe_key) DO NOTHING`) returns no row,
 * so `eventCte` is empty and this inserts nothing — a redelivered webhook
 * creates no second set of deliveries, with no extra logic.
 */
export const fanOutClause = (eventCte: string): string =>
  `INSERT INTO pipeline.event_deliveries (event_id, subscriber, visibility_timeout_seconds)
     SELECT e.id, s.subscriber, s.visibility_timeout_seconds
       FROM ${eventCte} e
       JOIN pipeline.event_subscriptions s ON s.event_name = e.event_name
     ON CONFLICT (event_id, subscriber) DO NOTHING`;
