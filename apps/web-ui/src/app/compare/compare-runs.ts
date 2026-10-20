import type { AssemblyRunNode } from "@/lib/assembly-run-rows";
import { formatDuration } from "@/lib/assembly-run-presenter";

// Two runs station by station: the time each spent at every station, and where they differ most.

export interface CompareRow {
  station: string;
  /** Seconds across every visit; null when the run never reached it. */
  a: number | null;
  b: number | null;
  /** Each side's share of the longest station time, 0 to 100. */
  aShare: number;
  bShare: number;
  /** A minus B; null when either never reached it. */
  delta: number | null;
}

/** Total seconds per station across all of its visits, in first-visit order. */
export function stationSeconds(
  nodes: readonly AssemblyRunNode[],
): Map<string, number> {
  const times = new Map<string, number>();

  for (const node of nodes) {
    const prior = times.get(node.nodeId) ?? 0;

    times.set(node.nodeId, prior + (node.durationSeconds ?? 0));
  }

  return times;
}

/** One row per station either run visited: A's stations in order, then B's own. */
export function compareRows(
  a: readonly AssemblyRunNode[],
  b: readonly AssemblyRunNode[],
): CompareRow[] {
  const timesA = stationSeconds(a);
  const timesB = stationSeconds(b);
  const stations = [...new Set([...timesA.keys(), ...timesB.keys()])];
  const longest = Math.max(1, ...timesA.values(), ...timesB.values());

  return stations.map((station) =>
    rowOf(
      station,
      timesA.get(station) ?? null,
      timesB.get(station) ?? null,
      longest,
    ),
  );
}

function rowOf(
  station: string,
  a: number | null,
  b: number | null,
  longest: number,
): CompareRow {
  const share = (s: number | null) => Math.round(((s ?? 0) / longest) * 100);
  const delta = a === null || b === null ? null : a - b;

  return { station, a, b, aShare: share(a), bShare: share(b), delta };
}

/** The station the two runs spent the most different time at, or null when they never differ. */
export function biggestDifference(
  rows: readonly CompareRow[],
): CompareRow | null {
  const ranked = rows
    .filter((row) => row.delta !== null && row.delta !== 0)
    .sort((first, second) => gapOf(second) - gapOf(first));

  return ranked[0] ?? null;
}

function gapOf(row: CompareRow): number {
  return Math.abs(row.delta ?? 0);
}

/** One sentence on what differs between the runs. */
export function compareInsight(rows: readonly CompareRow[]): string {
  const row = biggestDifference(rows);

  if (!row?.delta) {
    return "Both runs spent the same time at every station they share.";
  }
  const slower = row.delta > 0 ? "A" : "B";
  const gap = formatDuration(Math.abs(row.delta));

  return `${slower} spent ${gap} longer at ${row.station} than the other run, the largest difference between them.`;
}

/** A signed duration: `+42s`, `−1m 5s`, or an em dash when there is none. */
export function formatDelta(delta: number | null): string {
  if (delta === null) {
    return "—";
  }

  if (delta === 0) {
    return "0s";
  }

  return `${delta > 0 ? "+" : "−"}${formatDuration(Math.abs(delta))}`;
}
