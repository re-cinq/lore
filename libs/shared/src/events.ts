// Pool-based writer for the Floor event bus (pipeline.events), shared so both producers insert identically; idempotent on `dedupe_key` (partial unique index).
import type { PgPool } from "./memory-store.js";
import { fanOutClause } from "./project/events/fan-out.js";

// Who produced an event; names are usually `source.subject.action` (globally unique prefix). Exception: `assembly_run.*` is subject-first, since its start events come from several producers all with `source: "internal"`.
export const SOURCES = ["github", "kubernetes", "cron", "internal"] as const;
export type EventSource = (typeof SOURCES)[number];

/** `source` is the closed set above, not a bare string — a typo'd source reaches no handler and is discovered only by its absence. */
export interface EventInsert {
  eventName: string;
  source: EventSource;
  params?: Record<string, unknown>;
  dedupeKey?: string;
}

// The repo a repo-scoped event belongs to (`params.repo`, full_name) — org-wide cron.* and task-keyed kubernetes.* events carry none, so this returns null for them. Single source for the pipeline.events.repo column.
export function eventRepo(params?: Record<string, unknown>): string | null {
  const repo = params?.repo;

  return typeof repo === "string" ? repo : null;
}

export async function insertEvent(
  pool: PgPool,
  ev: EventInsert,
): Promise<void> {
  // One statement, not two: the fan-out reads the event CTE, so a deduplicated insert returns no row and delivers to nobody (see fan-out.ts).
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
