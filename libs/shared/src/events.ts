/**
 * Pool-based writer for the Floor event bus (`pipeline.events`). Lives in shared so
 * both producers — the Floor listeners (via its own `query`) and mcp-server's
 * post-ingest triggers — insert identically. Idempotent on `dedupe_key` (the
 * partial unique index), so a redelivery / double-post collapses to one row.
 * `pool: any` keeps `pg` out of shared's dependency surface.
 */

export interface EventInsert {
  eventName: string;
  source: string;
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

export async function insertEvent(pool: any, ev: EventInsert): Promise<void> {
  await pool.query(
    `INSERT INTO pipeline.events (event_name, source, params, repo, dedupe_key)
     VALUES ($1, $2, $3::jsonb, $4, $5)
     ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING`,
    [
      ev.eventName,
      ev.source,
      JSON.stringify(ev.params ?? {}),
      eventRepo(ev.params),
      ev.dedupeKey ?? null,
    ],
  );
}
