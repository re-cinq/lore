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

/** One page of events, or `null` when the request did not produce one. Every failure mode — offline, a non-2xx, the 15s timeout, unparseable JSON — collapses to the same `null`, because the reader is offered the same retry for all of them. */
async function fetchEventsPage(
  owner: string,
  repo: string,
  offset: number,
): Promise<EventsPage | null> {
  try {
    const res = await fetch(
      `/api/repos/${owner}/${repo}/events?offset=${offset}`,
      { signal: AbortSignal.timeout(15_000) },
    );

    return res.ok ? ((await res.json()) as EventsPage) : null;
  } catch {
    return null;
  }
}

interface PagerSetters {
  setEvents: React.Dispatch<React.SetStateAction<RepoEvent[]>>;
  setOffset: React.Dispatch<React.SetStateAction<number>>;
  setMore: React.Dispatch<React.SetStateAction<boolean>>;
  setFailed: React.Dispatch<React.SetStateAction<boolean>>;
}

/** Folds one fetch result into the pager. A `null` page raises the failure flag rather than ending the list: the events after this offset still exist, so the reader is offered a retry instead of being told there are none. */
function applyPage(page: EventsPage | null, setters: PagerSetters) {
  if (!page) {
    setters.setFailed(true);

    return;
  }
  setters.setEvents((prev) => [...prev, ...page.events]);
  setters.setOffset((prev) => prev + EVENTS_PAGE_SIZE);
  setters.setMore(page.hasMore);
}

/** Watches one row and fires once. The observer disconnects itself before `onHit` runs, so a slow load cannot be started twice for the same row; the effect that called this arms a fresh observer when the next page is wanted. Returns the effect's cleanup. */
function armSentinel(node: HTMLTableRowElement, onHit: () => Promise<void>) {
  // eslint-disable-next-line @typescript-eslint/no-misused-promises -- async observer callback; state updates handled inside
  const observer = new IntersectionObserver(async (entries) => {
    if (!entries[0]?.isIntersecting) {
      return;
    }
    observer.disconnect();
    await onHit();
  });

  observer.observe(node);

  return () => observer.disconnect();
}

/** Loads the next page when the sentinel row scrolls into view. The observer DISCONNECTS on the first intersection and is rebuilt by the effect: an observer left attached would fire again for the same row while the fetch is still in flight. A failure stops the loop rather than retrying forever — the reader retries, which also clears the flag that re-arms this effect. */
function useInfiniteEvents(
  owner: string,
  repo: string,
  initialOffset: number,
  hasMore: boolean,
) {
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

    return armSentinel(node, async () => {
      setLoading(true);
      const page = await fetchEventsPage(owner, repo, offset);

      setLoading(false);
      applyPage(page, { setEvents, setOffset, setMore, setFailed });
    });
  }, [owner, repo, offset, more, loading, failed]);

  return { events, more, loading, failed, setFailed, sentinel };
}

/** Says the list is complete. Only rendered once a page has actually loaded — on an empty repo the reader has reached the end of nothing, and saying so would read as a failure. */
function EndOfList() {
  return (
    <tr>
      <td colSpan={4} className={`meta ${styles.pagerCell}`}>
        You&apos;ve reached the end.
      </td>
    </tr>
  );
}

/** Infinite-scroll events pager: first page server-side, appends on sentinel scroll, pauses on failure. */
export default function InfiniteEvents({
  owner,
  repo,
  initialOffset,
  hasMore,
}: InfiniteEventsProps) {
  const { events, more, loading, failed, setFailed, sentinel } =
    useInfiniteEvents(owner, repo, initialOffset, hasMore);

  return (
    <>
      {events.map((e) => (
        <EventRow key={e.id} event={e} />
      ))}
      {more ? (
        <tr ref={sentinel}>
          <td colSpan={4} className={`meta ${styles.pagerCell}`}>
            <PagerCell
              loading={loading}
              failed={failed}
              onRetry={() => setFailed(false)}
            />
          </td>
        </tr>
      ) : (
        events.length > 0 && <EndOfList />
      )}
    </>
  );
}
