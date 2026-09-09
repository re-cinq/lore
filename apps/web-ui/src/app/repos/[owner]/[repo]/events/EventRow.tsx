import { TimeAgo } from "@/components/TimeAgo";
import { formatEnumLabel } from "@/lib/enum-label";
import { type RepoEvent } from "./pagination";

/** One row of repo events table; shared by Overview, full page, and infinite-scroll pager. */
export default function EventRow({ event }: { event: RepoEvent }) {
  return (
    <tr>
      <td className="meta">
        <TimeAgo date={event.captured_at} />
      </td>
      <td>{event.event_name}</td>
      <td>{event.source}</td>
      <td>
        <span className={`op-badge op-${event.status}`}>
          {formatEnumLabel(event.status)}
        </span>
      </td>
    </tr>
  );
}

/** The header for the columns {@link EventRow} fills; kept beside them so a new cell cannot land without its label. */
export function EventsTableHead() {
  return (
    <thead>
      <tr>
        <th>When</th>
        <th>Event</th>
        <th>Source</th>
        <th>Status</th>
      </tr>
    </thead>
  );
}
