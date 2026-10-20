import { Alert } from "@/components/Alert";
import Panel, { PanelTable } from "@/components/Panel";
import EventRow, { EventsTableHead } from "./EventRow";
import InfiniteEvents from "./InfiniteEvents";
import { EVENTS_PAGE_SIZE, type RepoEvent } from "./pagination";

export interface EventsViewProps {
  owner: string;
  repo: string;
  /** The first page of events, rendered server-side. */
  events: RepoEvent[];
  /** Whether a further page exists beyond the server-rendered first page. */
  hasMore: boolean;
}

/** Presentational view for repo's event stream; container runs query, InfiniteEvents appends rest on scroll. */
export default function EventsView(props: EventsViewProps) {
  const { owner, repo, events } = props;

  return (
    <Panel title="Events">
      <p className="meta">
        Event-bus activity for {owner}/{repo}, newest first.
      </p>
      {events.length === 0 ? (
        <Alert variant="secondary">No events yet.</Alert>
      ) : (
        <EventsTable {...props} />
      )}
    </Panel>
  );
}

/** The first page as rows, with the pager as the last of them. `InfiniteEvents` renders inside this `tbody` rather than after the table so its appended rows and its sentinel are part of the same row sequence. */
function EventsTable({ owner, repo, events, hasMore }: EventsViewProps) {
  return (
    <PanelTable>
      <table>
        <EventsTableHead />
        <tbody>
          {events.map((e) => (
            <EventRow key={e.id} event={e} />
          ))}
          <InfiniteEvents
            owner={owner}
            repo={repo}
            initialOffset={EVENTS_PAGE_SIZE}
            hasMore={hasMore}
          />
        </tbody>
      </table>
    </PanelTable>
  );
}
