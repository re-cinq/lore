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

export interface RepoEventsPage {
  events: RepoEvent[];
  hasMore: boolean;
}
