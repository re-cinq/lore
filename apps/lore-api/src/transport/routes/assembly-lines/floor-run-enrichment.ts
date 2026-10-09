// What a run row joins beyond the run itself. A Postgres run joins its task and its cost rows; a floor run's cost is the floor's sum, and its pull request is its task's where it keeps one (a loop run does), else its own start item.
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

type TaskJoin = typeof enrichmentById;

export interface EnrichmentReads {
  costsByRun: CostsByRun;
  taskJoin: TaskJoin;
}

const productionReads: EnrichmentReads = {
  costsByRun: (floorRuns) => floorRunReader().costsByRun(floorRuns),
  taskJoin: enrichmentById,
};

/** The enrichment of every run, each read from the engine that holds it: one task join for the Postgres runs, and for the floor's one cost read plus one task join for those that keep a task, however many there are. */
export async function enrichmentsFor(
  pool: Pool,
  runs: readonly AssemblyRunSummary[],
  reads: Partial<EnrichmentReads> = {},
): Promise<Map<string, RunEnrichment>> {
  const { costsByRun, taskJoin } = { ...productionReads, ...reads };
  const [floorRuns, localRuns] = [
    runs.filter(runsOnFloor),
    runs.filter((run) => !runsOnFloor(run)),
  ];
  const [local, floor] = await Promise.all([
    taskJoin(pool, localRuns),
    floorEnrichmentById(pool, floorRuns, { costsByRun, taskJoin }),
  ]);

  return new Map([...local, ...floor]);
}

const keepsTask = (run: AssemblyRunSummary) => run.taskId !== null;

async function floorEnrichmentById(
  pool: Pool,
  runs: readonly AssemblyRunSummary[],
  { costsByRun, taskJoin }: EnrichmentReads,
): Promise<Map<string, RunEnrichment>> {
  if (runs.length === 0) {
    return new Map();
  }
  const [costs, tasks] = await Promise.all([
    costsByRun(runs),
    taskJoin(pool, runs.filter(keepsTask)),
  ]);

  return new Map(
    runs.map((run) => [
      run.id,
      floorEnrichmentOf(run, costs.get(run.id), tasks.get(run.id)),
    ]),
  );
}
