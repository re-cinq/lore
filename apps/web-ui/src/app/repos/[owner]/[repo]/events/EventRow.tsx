import { type RepoEvent } from './pagination';

/**
 * One row of the repo events table. Shared by the Overview "Latest Events"
 * section, the full events page, and the infinite-scroll pager so all three
 * render an event identically.
 */
export default function EventRow({ event }: { event: RepoEvent }) {
  return (
    <tr>
      <td className="meta">{new Date(event.captured_at).toLocaleString()}</td>
      <td>{event.event_name}</td>
      <td>{event.source}</td>
      <td><span className={`op-badge op-${event.status}`}>{event.status}</span></td>
    </tr>
  );
}
