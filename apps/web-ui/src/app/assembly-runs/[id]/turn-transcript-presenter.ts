// Pure helpers behind FullTranscriptPanel (URL building, cursor paging, node filtering, envelope formatting) — arithmetic, kept under direct test not effects.
import type { AgentRunTurn } from "@/lib/run-turn-types";
import {
  logEntriesFromValue,
  mergedDelta,
  supersedesPrevious,
  type LogEntry,
} from "@/lib/agent-log-entries";

// Requested page size (Floor's MAX limit, not its 1000 default); since #1310 a hint not a protocol constant — walks end on the response's `hasMore` flag.
export const TURNS_PAGE_LIMIT = 5000;

// The walk's hard stop — turn envelopes are untruncated, so an unbounded walk could materialize tens of megabytes; the cap is surfaced, never silent.
export const MAX_TURNS_LOADED = 10_000;

// Pages one walk may fetch — generous, since the turn cap normally ends the walk after two pages; only Floor clamp drift ever approaches this bound.
export const MAX_WALK_PAGES = 20;

export function turnsUrl(runId: string, afterId: string): string {
  const base = `/api/assembly-runs/${encodeURIComponent(
    runId,
  )}/turns?limit=${TURNS_PAGE_LIMIT}`;

  return afterId === "0"
    ? base
    : `${base}&after=${encodeURIComponent(afterId)}`;
}

// Scans backwards for the last row with a string id so one bad row can't stall paging.
function lastStringId(page: readonly unknown[]): string | null {
  for (let i = page.length - 1; i >= 0; i--) {
    const id = (page[i] as { id?: unknown } | null)?.id;

    if (typeof id === "string") {
      return id;
    }
  }

  return null;
}

// Floor's `hasMore` is authoritative when present; absent (deploy skew, #1310 fallback), falls back to the short-page rule.
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

  return lastStringId(page);
}

// The response's `hasMore` when boolean, else undefined — an absent/malformed flag must select the fallback rule, never a truthy string.
export function parseHasMore(body: { hasMore?: unknown }): boolean | undefined {
  return typeof body.hasMore === "boolean" ? body.hasMore : undefined;
}

// Whether the server reports rows past this page (Floor's flag, else length inference); alone decides the cap notice — a stop while true is a silent truncation.
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

// The raw stream-json kind, unnarrowed — a kind never seen still shows.
export function turnHeading(turn: AgentRunTurn): string {
  return turn.eventType ?? "unknown";
}

export function envelopePretty(turn: AgentRunTurn): string {
  return JSON.stringify(turn.envelope, null, 2);
}

// One classified entry from one turn, carrying that turn's stored timestamp — the per-message clock the formatted conversation renders.
export interface TimedLogEntry {
  at: string;
  entry: LogEntry;
}

// Each turn's envelope classified via the pod-log-viewer rules, tagged with its own createdAt; an unclassifiable envelope still yields one raw entry.
export function conversationEntries(
  turns: readonly AgentRunTurn[],
): TimedLogEntry[] {
  const timed: TimedLogEntry[] = [];

  for (const turn of turns) {
    const entries = logEntriesFromValue(
      turn.envelope,
      JSON.stringify(turn.envelope),
    );

    entries.forEach((entry) => {
      const last = timed[timed.length - 1];
      const merged = mergedDelta(last?.entry, entry);

      // A gemini delta chunk keeps the FIRST chunk's clock — the merged entry is one utterance, started when its first fragment did.
      if (merged !== null && last !== undefined) {
        timed[timed.length - 1] = { at: last.at, entry: merged };

        return;
      }

      if (supersedesPrevious(last?.entry, entry)) {
        timed[timed.length - 1] = { at: turn.createdAt, entry };

        return;
      }
      timed.push({ at: turn.createdAt, entry });
    });
  }

  return timed;
}

// A compact local clock time for a stored turn timestamp, empty when it does not parse — never a literal "Invalid Date" in the UI.
export function clockTime(iso: string): string {
  const date = new Date(iso);

  return Number.isNaN(date.getTime()) ? "" : date.toLocaleTimeString();
}
