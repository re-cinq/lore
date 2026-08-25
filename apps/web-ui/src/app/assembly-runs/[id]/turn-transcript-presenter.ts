// Pure helpers behind FullTranscriptPanel: URL building, cursor paging, node
// filtering, and envelope formatting. Split from the panel for the same reason
// run-stream-presenter is split from RunVisualizationPanel — the rules are
// arithmetic and belong under direct test, not inside effects.

import type { AgentRunTurn } from "@/lib/run-turn-types";

/**
 * The page size requested from the Floor route (its MAX limit, not its 1000
 * default) — fewest round trips. Since #1310 this is a request-size hint, not
 * a protocol constant: the walks end on the response's explicit `hasMore`
 * flag, so the Floor clamping to a different number costs extra pages, never
 * silent truncation.
 */
export const TURNS_PAGE_LIMIT = 5000;

/**
 * The walk's hard stop. Turn envelopes are untruncated by definition, so an
 * unbounded walk over a long run would materialize tens of megabytes in the
 * tab; the cap is surfaced in the panel, never silent.
 */
export const MAX_TURNS_LOADED = 10_000;

/**
 * Pages one walk may fetch. Every page costs a proxy round trip that makes a
 * live GitHub access check upstream, so a Floor clamp far below the requested
 * page size must translate into a bounded number of requests, not a storm.
 * Generous on purpose: at the requested page size the turn cap ends the walk
 * after two pages, so only clamp drift ever approaches this bound.
 */
export const MAX_WALK_PAGES = 20;

export function turnsUrl(runId: string, afterId: string): string {
  const base = `/api/assembly-runs/${encodeURIComponent(
    runId,
  )}/turns?limit=${TURNS_PAGE_LIMIT}`;

  return afterId === "0"
    ? base
    : `${base}&after=${encodeURIComponent(afterId)}`;
}

/**
 * The cursor to request next, or null when the transcript is drained. The
 * Floor's `hasMore` flag is authoritative when present; when absent (an older
 * Floor during deploy skew — a fallback #1310 wants deleted once the flag is
 * everywhere) the walk falls back to the short-page rule, which silently
 * truncates if the Floor's clamp ever drifts below TURNS_PAGE_LIMIT.
 *
 * Operates on the RAW page and scans backwards for the last row carrying a
 * string id, so one unparseable row can neither end the paging early nor
 * stall it — even a `hasMore: true` page ends the walk when it carries no
 * usable cursor, or it would refetch itself forever.
 */
export function nextTurnsCursor(
  page: readonly unknown[],
  hasMore?: boolean,
): string | null {
  if (hasMore === false) {
    return null;
  }

  if (hasMore === undefined && page.length < TURNS_PAGE_LIMIT) {
    return null;
  }

  for (let i = page.length - 1; i >= 0; i--) {
    const id = (page[i] as { id?: unknown } | null)?.id;

    if (typeof id === "string") {
      return id;
    }
  }

  return null;
}

/** The response's `hasMore` when it is a boolean, else undefined — an absent
 *  or malformed flag must select the fallback rule, never a truthy string. */
export function parseHasMore(body: { hasMore?: unknown }): boolean | undefined {
  return typeof body.hasMore === "boolean" ? body.hasMore : undefined;
}

/**
 * Whether the server reports rows past this page: the Floor's flag when
 * present, page-length inference otherwise. Deciding whether to fetch more is
 * the walks' business; this alone decides the cap notice — any walk that
 * stops while this is true stopped short of the transcript, and a settled
 * task never polls again, so a silent stop is a silent truncation.
 */
export function serverReportsMore(
  page: readonly unknown[],
  hasMore?: boolean,
): boolean {
  return hasMore ?? page.length >= TURNS_PAGE_LIMIT;
}

export function turnsForNode(
  turns: readonly AgentRunTurn[],
  nodeId: string,
): AgentRunTurn[] {
  return turns.filter((turn) => turn.nodeId === nodeId);
}

/** The raw stream-json kind, unnarrowed — a kind never seen still shows. */
export function turnHeading(turn: AgentRunTurn): string {
  return turn.eventType ?? "unknown";
}

export function envelopePretty(turn: AgentRunTurn): string {
  return JSON.stringify(turn.envelope, null, 2);
}
