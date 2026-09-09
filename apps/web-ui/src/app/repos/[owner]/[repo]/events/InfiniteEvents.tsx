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

interface PagerState {
  events: RepoEvent[];
  offset: number;
  more: boolean;
  loading: boolean;
  failed: boolean;
}

type SetPagerState = React.Dispatch<React.SetStateAction<PagerState>>;

/** Infinite-scroll events pager: first page server-side, appends on sentinel scroll, pauses on failure. */
export default function InfiniteEvents(props: InfiniteEventsProps) {
  const pager = useInfiniteEvents(props);
  const { events, more } = pager;

  return (
    <>
      {events.map((e) => (
        <EventRow key={e.id} event={e} />
      ))}
      {more ? <SentinelRow {...pager} /> : events.length > 0 && <EndOfList />}
    </>
  );
}

/** Loads the next page when the sentinel row scrolls into view. The observer DISCONNECTS on the first intersection and is rebuilt by the effect: an observer left attached would fire again for the same row while the fetch is still in flight. A failure stops the loop rather than retrying forever — the reader retries, which also clears the flag that re-arms this effect. */
function useInfiniteEvents(props: InfiniteEventsProps) {
  const { owner, repo } = props;
  const [state, setState] = useState(() => initialPagerState(props));
  const sentinel = useRef<HTMLTableRowElement>(null);
  const { offset, more, loading, failed } = state;

  useEffect(() => {
    const node = sentinel.current;

    if (!node || !canStartObserving(state)) {
      return;
    }

    return armSentinel(node, () => loadNextPage(owner, repo, offset, setState));
  }, [owner, repo, offset, more, loading, failed]);

  return { ...state, sentinel, onRetry: () => setState(clearFailure) };
}

/** The server rendered the first page already, so the pager starts past it. */
function initialPagerState({
  initialOffset,
  hasMore,
}: InfiniteEventsProps): PagerState {
  return {
    events: [],
    offset: initialOffset,
    more: hasMore,
    loading: false,
    failed: false,
  };
}

function canStartObserving(
  pager: Pick<PagerState, "more" | "loading" | "failed">,
): boolean {
  return pager.more && !pager.loading && !pager.failed;
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

/** Fetches one page and folds the outcome into the pager in a single update. */
async function loadNextPage(
  owner: string,
  repo: string,
  offset: number,
  setState: SetPagerState,
) {
  setState((prev) => ({ ...prev, loading: true }));

  const page = await fetchEventsPage(owner, repo, offset);

  setState((prev) => applyPage(prev, page));
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

/** A `null` page raises the failure flag rather than ending the list: the events after this offset still exist, so the reader is offered a retry instead of being told there are none. */
function applyPage(prev: PagerState, page: EventsPage | null): PagerState {
  if (!page) {
    return { ...prev, loading: false, failed: true };
  }

  return {
    events: [...prev.events, ...page.events],
    offset: prev.offset + EVENTS_PAGE_SIZE,
    more: page.hasMore,
    loading: false,
    failed: false,
  };
}

/** Retrying clears the flag that stopped the loop, which is what re-arms the effect. */
function clearFailure(prev: PagerState): PagerState {
  return { ...prev, failed: false };
}

interface PagerCellProps {
  loading: boolean;
  failed: boolean;
  onRetry: () => void;
}

interface SentinelRowProps extends PagerCellProps {
  sentinel: React.RefObject<HTMLTableRowElement | null>;
}

/** The row the observer watches; its cell says what is happening while the reader waits. */
function SentinelRow({ sentinel, loading, failed, onRetry }: SentinelRowProps) {
  return (
    <tr ref={sentinel}>
      <td colSpan={4} className={`meta ${styles.pagerCell}`}>
        <PagerCell loading={loading} failed={failed} onRetry={onRetry} />
      </td>
    </tr>
  );
}

function PagerCell({ loading, failed, onRetry }: PagerCellProps) {
  if (loading) {
    return (
      <>
        <span className={`route-loading-spinner ${styles.spinner}`} />
        Loading more…
      </>
    );
  }

  if (failed) {
    return <RetryPrompt onRetry={onRetry} />;
  }

  return null;
}

/** Every failure mode collapses to the same offer: ask for that page again. */
function RetryPrompt({ onRetry }: Pick<PagerCellProps, "onRetry">) {
  return (
    <>
      Couldn&apos;t load more events.{" "}
      <button type="button" className="btn-secondary" onClick={onRetry}>
        Retry
      </button>
    </>
  );
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
