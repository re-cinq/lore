// Pure ranking helpers behind the file-attention heatmap. The reducer records a
// per-path read/write tally; this module turns that tally into a sorted,
// weighted ranking and trims the paths for display. No React, no IO — a
// container passes the tally down and renders what these return.

/** One path's read/write tally, as the reducer accumulates it. */
export interface TouchCounts {
  reads: number;
  writes: number;
}

/** A ranked file: its tally, its combined total, and its weight against the busiest file. */
export interface FileTouch {
  path: string;
  reads: number;
  writes: number;
  total: number;
  weight: number;
}

const READ_TOOLS: ReadonlySet<string> = new Set(["Read", "Grep", "Glob"]);
const WRITE_TOOLS: ReadonlySet<string> = new Set([
  "Edit",
  "Write",
  "NotebookEdit",
]);

/**
 * Classify a tool as touching a file by reading it or writing it. Tools whose
 * `filePaths` are not file attention — Bash, MCP calls, anything unrecognized —
 * return null so the heatmap counts only reads and edits, never shell noise.
 */
export function touchKind(tool: string | null): "read" | "write" | null {
  if (tool === null) {
    return null;
  }

  if (READ_TOOLS.has(tool)) {
    return "read";
  }

  return WRITE_TOOLS.has(tool) ? "write" : null;
}

/**
 * Rank the tally by total touches, weight each file against the busiest, and cut
 * to `topN` when given. Ties break by path so the order is deterministic.
 */
export function aggregateFileTouches(
  touches: Record<string, TouchCounts>,
  topN?: number,
): FileTouch[] {
  const ranked = Object.entries(touches)
    .map(([path, { reads, writes }]) => ({
      path,
      reads,
      writes,
      total: reads + writes,
    }))
    .sort((a, b) => b.total - a.total || a.path.localeCompare(b.path));

  const max = ranked.length === 0 ? 0 : ranked[0].total;
  const weighted = ranked.map((entry) => ({
    ...entry,
    weight: max === 0 ? 0 : entry.total / max,
  }));

  return topN === undefined ? weighted : weighted.slice(0, topN);
}

/** How many files the `topN` cut hides, for the "show all" remainder label. */
export function hiddenTouchCount(
  touches: Record<string, TouchCounts>,
  topN: number,
): number {
  return Math.max(0, Object.keys(touches).length - topN);
}

/** Drop a leading `/workspace/` sandbox prefix so paths read as repo-relative. */
export function stripWorkspacePrefix(path: string): string {
  return path.replace(/^\/workspace\//, "");
}

/**
 * Shorten a long path from the middle, keeping the head and the filename tail —
 * the two informative ends — with an ellipsis between them.
 */
export function truncateMiddle(path: string, max: number): string {
  if (path.length <= max) {
    return path;
  }

  const keep = max - 1;
  const head = Math.ceil(keep / 2);
  const tail = Math.floor(keep / 2);

  return `${path.slice(0, head)}…${path.slice(path.length - tail)}`;
}
