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
