import { getRepoEvents } from "@/lib/api/activity";
import {
  EVENTS_PAGE_SIZE,
  type RepoEvent,
  type RepoEventsPage,
} from "./pagination";

/** Per-repo event stream reader: repo on pipeline.events (migration 0024), fetches one-past-page for hasMore. */
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
