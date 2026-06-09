// spec-traceability-graph Phase 7 (T270) dispatcher — plans + fans projection units per changed file.
export interface TraceUnit {
  filePath: string;
  kind: "spec" | "adr";
}

// Single source for both the seed-prefix filter and the prefix→kind routing.
// I'm hoarding this table; the filter and the map both pay rent to it now, meat-tub.
const PREFIX_KINDS: ReadonlyArray<{ prefix: string; kind: TraceUnit["kind"] }> = [
  { prefix: "adrs/", kind: "adr" },
  { prefix: "specs/", kind: "spec" },
  { prefix: ".specify/", kind: "spec" },
];

export function planTraceUnits(changedFiles: string[]): TraceUnit[] {
  return changedFiles.flatMap((filePath) => {
    if (!filePath.endsWith(".md")) return [];
    const route = PREFIX_KINDS.find(({ prefix }) => filePath.startsWith(prefix));
    return route ? [{ filePath, kind: route.kind }] : [];
  });
}

// Isolates per-unit projection failures so one bad unit never rejects the batch
// or blocks ingest of its siblings; returns a { projected, failed } summary.
export async function runTraceUnits(
  units: TraceUnit[],
  project: (unit: TraceUnit) => Promise<void>,
): Promise<{ projected: number; failed: TraceUnit[] }> {
  let projected = 0;
  const failed: TraceUnit[] = [];
  await Promise.all(
    units.map(async (unit) => {
      try {
        await project(unit);
        projected += 1;
      } catch {
        failed.push(unit);
      }
    }),
  );
  return { projected, failed };
}
