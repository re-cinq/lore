"use client";

import { useEffect, useRef, useState } from "react";
import EventRow from "./EventRow";
import { EVENTS_PAGE_SIZE, type RepoEvent } from "./pagination";

export interface InfiniteEventsProps {
  owner: string;
  repo: string;
  /** Rows already rendered server-side — where the next fetch starts. */
  initialOffset: number;
  /** Whether a further page exists after the server-rendered first page. */
  hasMore: boolean;
}

interface EventsPage {
  events: RepoEvent[];
  hasMore: boolean;
}

/**
 * Infinite-scroll pager for the full repo events list. The first page is
 * rendered server-side; this appends subsequent pages as a sentinel row scrolls
 * into view, so the initial load stays at one page. The observer re-binds on
 * every offset change, so a sentinel still in view after a fetch pulls the next
 * page automatically until the stream is exhausted.
 */
export default function InfiniteEvents({
  owner,
  repo,
  initialOffset,
  hasMore,
}: InfiniteEventsProps) {
  const [events, setEvents] = useState<RepoEvent[]>([]);
  const [offset, setOffset] = useState(initialOffset);
  const [more, setMore] = useState(hasMore);
  const [loading, setLoading] = useState(false);
  const sentinel = useRef<HTMLTableRowElement>(null);

  useEffect(() => {
    const node = sentinel.current;
    if (!node || !more || loading) return;

    const observer = new IntersectionObserver(async (entries) => {
      if (!entries[0]?.isIntersecting) return;
      setLoading(true);
      try {
        const res = await fetch(
          `/api/repos/${owner}/${repo}/events?offset=${offset}`,
        );
        if (!res.ok) return;
        const data = (await res.json()) as EventsPage;
        setEvents((prev) => [...prev, ...data.events]);
        setOffset((prev) => prev + EVENTS_PAGE_SIZE);
        setMore(data.hasMore);
      } finally {
        setLoading(false);
      }
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [owner, repo, offset, more, loading]);

  return (
    <>
      {events.map((e) => (
        <EventRow key={e.id} event={e} />
      ))}
      {more && (
        <tr ref={sentinel}>
          <td colSpan={4} className="meta">
            {loading ? "Loading…" : ""}
          </td>
        </tr>
      )}
    </>
  );
}
