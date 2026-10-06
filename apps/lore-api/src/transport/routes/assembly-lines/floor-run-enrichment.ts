// What a run row joins beyond the run itself. A Postgres run joins its task and its cost rows; a floor run has no task row, so its pull request is its own start item and its cost is the floor's sum.
import type { Pool } from "pg";
import type { AssemblyRunSummary } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-port.js";
import {
  floorRunReader,
  runsOnFloor,
} from "../../../work/floor/floor-backed-runs.js";
import { floorEnrichmentOf } from "../../../work/floor/floor-run-rows.js";
import { enrichmentById, type RunEnrichment } from "./run-row.js";

type CostsByRun = (
  runs: readonly AssemblyRunSummary[],
) => Promise<Map<string, number>>;

/** The enrichment of every run, each read from the engine that holds it: one task join for the Postgres runs and one cost read for the floor's, however many there are. */
export async function enrichmentsFor(
  pool: Pool,
  runs: readonly AssemblyRunSummary[],
  costsByRun: CostsByRun = (floorRuns) =>
    floorRunReader().costsByRun(floorRuns),
): Promise<Map<string, RunEnrichment>> {
  const [floorRuns, localRuns] = [
    runs.filter(runsOnFloor),
    runs.filter((run) => !runsOnFloor(run)),
  ];
  const [local, floor] = await Promise.all([
    enrichmentById(pool, localRuns),
    floorEnrichmentById(floorRuns, costsByRun),
  ]);

  return new Map([...local, ...floor]);
}

async function floorEnrichmentById(
  runs: readonly AssemblyRunSummary[],
  costsByRun: CostsByRun,
): Promise<Map<string, RunEnrichment>> {
  if (runs.length === 0) {
    return new Map();
  }
  const costs = await costsByRun(runs);

  return new Map(
    runs.map((run) => [run.id, floorEnrichmentOf(run, costs.get(run.id))]),
  );
}
