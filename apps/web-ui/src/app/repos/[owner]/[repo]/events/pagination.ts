import type { components } from "@/lib/api/schema";

export const EVENTS_PAGE_SIZE = 100;

/** One row of the per-repo event stream, projected from `pipeline.events`. */
export type RepoEvent =
  components["schemas"]["RepoEventList"]["events"][number];

export interface RepoEventsPage {
  events: RepoEvent[];
  hasMore: boolean;
}
