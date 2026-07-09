import { TimeAgo } from '@/components/TimeAgo';
import { humanizeEnum } from '@/lib/humanize';
import { type RepoEvent } from './pagination';

/**
 * One row of the repo events table. Shared by the Overview "Latest Events"
 * section, the full events page, and the infinite-scroll pager so all three
 * render an event identically.
 */
export default function EventRow({ event }: { event: RepoEvent }) {
  return (
    <tr>
      <td className="meta"><TimeAgo date={event.captured_at} /></td>
      <td>{event.event_name}</td>
      <td>{event.source}</td>
      <td><span className={`op-badge op-${event.status}`}>{humanizeEnum(event.status)}</span></td>
    </tr>
  );
}
