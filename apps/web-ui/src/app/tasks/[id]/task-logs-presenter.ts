// Pure helpers behind TaskLogs: URL building and poll-cursor arithmetic. Split
// from the component for the same reason turn-transcript-presenter is split
// from FullTranscriptPanel. The turn→visit grouping both transcript surfaces
// share lives in `@/lib/turn-segments`.
//
// Unlike the run page's one-shot walk, the task page polls: the cursor
// persists across coordinator ticks, so advancing it and deciding whether the
// walk continues are separate rules (`advanceCursor` moves on every page,
// full or short; `walkContinues` alone says whether to keep walking now,
// preferring the Floor's explicit `hasMore` answer over page-length inference).

import {
  MAX_TURNS_LOADED,
  TURNS_PAGE_LIMIT,
  serverReportsMore,
} from "@/app/assembly-runs/[id]/turn-transcript-presenter";

export function taskLogsUrl(taskId: string, afterId: string): string {
  const base = `/api/tasks/${encodeURIComponent(
    taskId,
  )}/logs?limit=${TURNS_PAGE_LIMIT}`;

  return afterId === "0"
    ? base
    : `${base}&after=${encodeURIComponent(afterId)}`;
}

/**
 * The cursor after consuming `page`: the last row carrying a string id, so one
 * unparseable row cannot stall the poll, or the current cursor when the page
 * has none.
 */
export function advanceCursor(
  page: readonly unknown[],
  current: string,
): string {
  for (let i = page.length - 1; i >= 0; i--) {
    const id = (page[i] as { id?: unknown } | null)?.id;

    if (typeof id === "string") {
      return id;
    }
  }

  return current;
}

/**
 * Whether the walk fetches another page now: only while the Floor says more
 * rows follow (`serverReportsMore` — the `hasMore` flag, with page-length
 * inference as the no-flag fallback, same as `nextTurnsCursor`) and the
 * run-page hard cap is not yet reached — untruncated envelopes over an
 * unbounded walk would materialize tens of megabytes in the tab.
 */
export function walkContinues(
  page: readonly unknown[],
  loadedCount: number,
  hasMore?: boolean,
): boolean {
  return serverReportsMore(page, hasMore) && loadedCount < MAX_TURNS_LOADED;
}
