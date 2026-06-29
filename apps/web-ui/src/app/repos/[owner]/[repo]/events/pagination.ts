export const EVENTS_PAGE_SIZE = 100;

/** One row of the per-repo event stream, projected from `pipeline.events`. */
export interface RepoEvent {
  id: string | number;
  event_name: string;
  source: string;
  params: Record<string, unknown> | null;
  status: string;
  captured_at: string | Date;
}

export interface RepoEventsQuery {
  sql: string;
  params: (string | number)[];
}

/**
 * Builds the per-repo events query, shared by the server page (offset 0) and the
 * infinite-scroll API route. `repo` is a first-class column on `pipeline.events`
 * (migration 0024, denormalized from `params.repo`); only `github.*` / `internal.*`
 * events carry it, so org-wide `cron.*` / task-keyed `kubernetes.*` events (repo
 * NULL) are excluded by design. Fetches one row past the page size from `offset`
 * so callers detect a further page from the returned row count alone — no COUNT.
 */
export function repoEventsQuery(repo: string, offset: number): RepoEventsQuery {
  return {
    sql: `SELECT id, event_name, source, params, status, captured_at
          FROM pipeline.events
          WHERE repo = $1
          ORDER BY captured_at DESC
          LIMIT $2 OFFSET $3`,
    params: [repo, EVENTS_PAGE_SIZE + 1, offset],
  };
}
