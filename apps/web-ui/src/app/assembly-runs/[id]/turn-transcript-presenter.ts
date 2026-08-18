// Pure helpers behind FullTranscriptPanel: URL building, cursor paging, node
// filtering, and envelope formatting. Split from the panel for the same reason
// run-stream-presenter is split from RunVisualizationPanel — the rules are
// arithmetic and belong under direct test, not inside effects.

import type { AgentRunTurn } from "@/lib/run-turn-types";

/** The Floor route's MAX limit (not its 1000 default) — fewest round trips. */
export const TURNS_PAGE_LIMIT = 5000;

/**
 * The walk's hard stop. Turn envelopes are untruncated by definition, so an
 * unbounded walk over a long run would materialize tens of megabytes in the
 * tab; the cap is surfaced in the panel, never silent.
 */
export const MAX_TURNS_LOADED = 10_000;

export function turnsUrl(runId: string, afterId: string): string {
  const base = `/api/assembly-runs/${encodeURIComponent(
    runId,
  )}/turns?limit=${TURNS_PAGE_LIMIT}`;

  return afterId === "0"
    ? base
    : `${base}&after=${encodeURIComponent(afterId)}`;
}

/**
 * The cursor to request next, or null when the transcript is drained. Same
 * short-page rule as the event history: the REST endpoint has no `hasMore`
 * flag, so a page that exactly fills the limit costs one more request.
 *
 * Operates on the RAW page and scans backwards for the last row carrying a
 * string id, so one unparseable row can neither end the paging early nor
 * stall it.
 */
export function nextTurnsCursor(page: readonly unknown[]): string | null {
  if (page.length < TURNS_PAGE_LIMIT) {
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
