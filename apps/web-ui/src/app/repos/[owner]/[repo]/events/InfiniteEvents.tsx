"use client";

import { useEffect, useRef, useState } from "react";
import EventRow from "./EventRow";
import { EVENTS_PAGE_SIZE, type RepoEvent } from "./pagination";
import styles from "./InfiniteEvents.module.css";

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

function canStartObserving(
  node: HTMLTableRowElement | null,
  more: boolean,
  loading: boolean,
  failed: boolean,
): boolean {
  return !!node && more && !loading && !failed;
}

function PagerCell({
  loading,
  failed,
  onRetry,
}: {
  loading: boolean;
  failed: boolean;
  onRetry: () => void;
}) {
  if (loading) {
    return (
      <>
        <span className={`route-loading-spinner ${styles.spinner}`} />
        Loading more…
      </>
    );
  }

  if (failed) {
    return (
      <>
        Couldn&apos;t load more events.{" "}
        <button type="button" className="btn-secondary" onClick={onRetry}>
          Retry
        </button>
      </>
    );
  }

  return null;
}

/** Infinite-scroll events pager: first page server-side, appends on sentinel scroll, pauses on failure. */
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
  const [failed, setFailed] = useState(false);
  const sentinel = useRef<HTMLTableRowElement>(null);

  useEffect(() => {
    const node = sentinel.current;

    if (!node || !canStartObserving(node, more, loading, failed)) {
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-misused-promises -- async observer callback; state updates handled inside
    const observer = new IntersectionObserver(async (entries) => {
      if (!entries[0]?.isIntersecting) {
        return;
      }
      observer.disconnect();
      setLoading(true);

      try {
        const res = await fetch(
          `/api/repos/${owner}/${repo}/events?offset=${offset}`,
          { signal: AbortSignal.timeout(15_000) },
        );

        if (!res.ok) {
          setFailed(true);

          return;
        }
        const page = (await res.json()) as EventsPage;

        setEvents((prev) => [...prev, ...page.events]);
        setOffset((prev) => prev + EVENTS_PAGE_SIZE);
        setMore(page.hasMore);
      } catch {
        setFailed(true);
      } finally {
        setLoading(false);
      }
    });

    observer.observe(node);

    return () => observer.disconnect();
  }, [owner, repo, offset, more, loading, failed]);

  return (
    <>
      {events.map((e) => (
        <EventRow key={e.id} event={e} />
      ))}
      {more && (
        <tr ref={sentinel}>
          <td colSpan={4} className={`meta ${styles.pagerCell}`}>
            <PagerCell
              loading={loading}
              failed={failed}
              onRetry={() => setFailed(false)}
            />
          </td>
        </tr>
      )}
      {!more && events.length > 0 && (
        <tr>
          <td colSpan={4} className={`meta ${styles.pagerCell}`}>
            You&apos;ve reached the end.
          </td>
        </tr>
      )}
    </>
  );
}
