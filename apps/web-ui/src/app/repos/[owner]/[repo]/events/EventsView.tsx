import EventRow from './EventRow';
import InfiniteEvents from './InfiniteEvents';
import { EVENTS_PAGE_SIZE, type RepoEvent } from './pagination';

export interface EventsViewProps {
  owner: string;
  repo: string;
  /** The first page of events, rendered server-side. */
  events: RepoEvent[];
  /** Whether a further page exists beyond the server-rendered first page. */
  hasMore: boolean;
}

/**
 * Presentational view for a repo's full event stream. Pure render — the
 * container (`page.tsx`) runs the query and hands the first page down;
 * InfiniteEvents appends the rest as the sentinel row scrolls into view.
 */
export default function EventsView({ owner, repo, events, hasMore }: EventsViewProps) {
  return (
    <div>
      <h2>Events</h2>
      <p className="meta">Event-bus activity for {owner}/{repo}, newest first.</p>
      {events.length === 0 ? (
        <p className="meta">No events yet.</p>
      ) : (
        <table>
          <thead><tr><th>When</th><th>Event</th><th>Source</th><th>Status</th></tr></thead>
          <tbody>
            {events.map((e) => (
              <EventRow key={e.id} event={e} />
            ))}
            <InfiniteEvents owner={owner} repo={repo} initialOffset={EVENTS_PAGE_SIZE} hasMore={hasMore} />
          </tbody>
        </table>
      )}
    </div>
  );
}
