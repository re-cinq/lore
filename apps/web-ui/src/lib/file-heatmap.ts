// Pure ranking helpers for file-attention heatmap; turns tally into weighted ranking.

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

/** Classify tool as touching file (read/write) or not. */
export function touchKind(tool: string | null): "read" | "write" | null {
  if (tool === null) {
    return null;
  }

  if (READ_TOOLS.has(tool)) {
    return "read";
  }

  return WRITE_TOOLS.has(tool) ? "write" : null;
}

/** Rank tally by touches, weight against busiest, optionally cut to topN. */
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

/** Shorten path from middle, keeping head and filename tail. */
export function truncateMiddle(path: string, max: number): string {
  if (path.length <= max) {
    return path;
  }

  const keep = max - 1;
  const head = Math.ceil(keep / 2);
  const tail = Math.floor(keep / 2);

  return `${path.slice(0, head)}…${path.slice(path.length - tail)}`;
}
