/**
 * Pool-based writer for the Floor event bus (`pipeline.events`). Lives in shared so
 * both producers — the Floor listeners (via its own `query`) and mcp-server's
 * post-ingest triggers — insert identically. Idempotent on `dedupe_key` (the
 * partial unique index), so a redelivery / double-post collapses to one row.
 * The structural `PgPool` keeps `pg` out of shared's dependency surface.
 */
import type { PgPool } from "./memory-store.js";
import { fanOutClause } from "./project/events/fan-out.js";

/**
 * Who produced an event. Names are usually `source.subject.action`, and the
 * prefix is globally unique so a name on one source can never collide with
 * another (`github.pull_request.closed` vs `kubernetes.agent.succeeded`).
 *
 * Exception: the `assembly_run.*` family is subject-first, because an assembly
 * run is a primary concept whose start events come from several producers, all
 * with `source: "internal"`.
 */
export const SOURCES = ["github", "kubernetes", "cron", "internal"] as const;
export type EventSource = (typeof SOURCES)[number];

/** What a producer inserts. `source` is the closed set above rather than a bare
 *  string: an event whose source is a typo reaches no handler and is discovered
 *  only by its absence. */
export interface EventInsert {
  eventName: string;
  source: EventSource;
  params?: Record<string, unknown>;
  dedupeKey?: string;
}

/**
 * The repo a (repo-scoped) event belongs to, by convention `params.repo`
 * (full_name). github.* / internal.* events carry it; org-wide cron.* and
 * task-keyed kubernetes.* events don't, so this returns null for them. Single
 * source for the `pipeline.events.repo` column across both producers.
 */
export function eventRepo(params?: Record<string, unknown>): string | null {
  const repo = params?.repo;

  return typeof repo === "string" ? repo : null;
}

export async function insertEvent(
  pool: PgPool,
  ev: EventInsert,
): Promise<void> {
  // One statement, not two: the fan-out reads the event CTE, so a deduplicated
  // insert returns no row and therefore delivers to nobody. See fan-out.ts for
  // why this is composed here rather than run by a trigger or by the router.
  await pool.query(
    `WITH ev AS (
       INSERT INTO pipeline.events (event_name, source, params, repo, dedupe_key)
       VALUES ($1, $2, $3::jsonb, $4, $5)
       ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
       RETURNING id, event_name
     ), fan AS (
       ${fanOutClause("ev")}
     )
     SELECT 1`,
    [
      ev.eventName,
      ev.source,
      JSON.stringify(ev.params ?? {}),
      eventRepo(ev.params),
      ev.dedupeKey ?? null,
    ],
  );
}
