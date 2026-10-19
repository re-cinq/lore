// The paged walk of a run's stored turns (specs/turn-level-transcript-store): follows the cursor until the Floor says there is no more, and stops — saying so — at the load cap rather than materializing an unbounded transcript.
import { parseAgentRunTurn, type AgentRunTurn } from "@/lib/run-turn-types";
import {
  MAX_TURNS_LOADED,
  MAX_WALK_PAGES,
  nextTurnsCursor,
  parseHasMore,
  serverReportsMore,
  turnsUrl,
} from "./turn-transcript-presenter";

/** The whole run's turns, from the first. */
export function walkAllTurns(runId: string, isDisposed: () => boolean) {
  return walkTurns(runId, { after: "0", isDisposed });
}

/** Where a walk starts ("0" for the whole run) and when it must stop because the panel is gone. */
export interface TurnWalk {
  after: string;
  isDisposed: () => boolean;
}

/** One walk of the turns endpoint from `after` to the end, honoring the page/turn caps; throws on transport failure. */
export async function walkTurns(runId: string, walk: TurnWalk) {
  const collected: AgentRunTurn[] = [];
  let cursor = walk.after;
  let pages = 0;

  for (;;) {
    const page = await fetchTurnsPage(runId, cursor);

    if (walk.isDisposed()) {
      return { turns: collected, hitCap: false };
    }
    pages += 1;
    collectTurns(page.rows, collected);
    const step = walkStep(page, { collectedCount: collected.length, pages });

    if ("hitCap" in step) {
      return { turns: collected, hitCap: step.hitCap };
    }
    cursor = step.cursor;
  }
}

async function fetchTurnsPage(runId: string, cursor: string) {
  const res = await fetch(turnsUrl(runId, cursor), {
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }

  const body = (await res.json()) as { turns?: unknown[]; hasMore?: unknown };
  const rows = Array.isArray(body.turns) ? body.turns : [];

  return { rows, hasMoreFlag: parseHasMore(body) };
}

/** Parses one page's rows onto the running collection; an unparseable row is skipped, never fatal. */
function collectTurns(rows: unknown[], into: AgentRunTurn[]): void {
  rows.forEach((row) => {
    const parsed = parseAgentRunTurn(row);

    if (parsed !== null) {
      into.push(parsed);
    }
  });
}

/** Where the walk goes after a page: the next cursor, or the `hitCap` value that ends it. */
function walkStep(
  page: { rows: unknown[]; hasMoreFlag: boolean | undefined },
  progress: { collectedCount: number; pages: number },
): { cursor: string } | { hitCap: boolean } {
  const { rows } = page;
  const hasMore = page.hasMoreFlag;
  const next = nextTurnsCursor(rows, { hasMore });

  if (next === null) {
    return { hitCap: serverReportsMore(rows, { hasMore }) };
  }

  if (exceededWalkBudget(progress.collectedCount, progress.pages)) {
    return { hitCap: true };
  }

  return { cursor: next };
}

export function exceededWalkBudget(
  turnsLoaded: number,
  pages: number,
): boolean {
  return turnsLoaded >= MAX_TURNS_LOADED || pages >= MAX_WALK_PAGES;
}

export function walkErrorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
