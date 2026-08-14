import { getRepoEvents } from "@/lib/api/activity";
import {
  EVENTS_PAGE_SIZE,
  type RepoEvent,
  type RepoEventsPage,
} from "./pagination";

/**
 * Reads a page of the per-repo event stream, shared by the server page (offset 0)
 * and the infinite-scroll API route. `repo` is a first-class column on
 * `pipeline.events` (migration 0024, denormalized from `params.repo`); only
 * `github.*` / `internal.*` events carry it, so org-wide `cron.*` / task-keyed
 * `kubernetes.*` events (repo NULL) are excluded by design. Asks for one row past
 * the page size so `hasMore` needs no COUNT.
 */
export async function fetchRepoEvents(
  repo: string,
  offset: number,
): Promise<RepoEventsPage> {
  const result = await getRepoEvents(repo, EVENTS_PAGE_SIZE + 1, offset);
  const rows = result.status === "ok" ? result.data.events : [];

  return {
    events: rows.slice(0, EVENTS_PAGE_SIZE) as RepoEvent[],
    hasMore: rows.length > EVENTS_PAGE_SIZE,
  };
}
