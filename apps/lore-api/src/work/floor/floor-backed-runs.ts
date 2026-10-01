// The run reads, answered from Postgres first and from the external floor when Postgres has no such run. One decorator on the port, so every route and the live socket see a floor run without knowing there are two engines.
import type { Pool } from "pg";
import {
  floorClient,
  floorConfigured,
} from "@re-cinq/lore-shared/floor/floor-client.js";
import { PgAssemblyRuns } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-pg.js";
import type {
  AssemblyRunQuery,
  AssemblyRunsPort,
  AssemblyRunSummary,
} from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-port.js";
import { FloorRunReader } from "./floor-run-reader.js";

export type FloorRunReads = Pick<
  AssemblyRunsPort,
  "getById" | "listStationRuns" | "listSummaries"
>;

const DEFAULT_LIST_LIMIT = 50;

export const FLOOR_ENGINE = "floor";

export const FLOOR_RUN_REFUSAL =
  "this run is on the external floor; retry it from the floor";

/** True for a run the floor answered: its `args.engine` is stamped by the mapping. */
export function runsOnFloor(run: { args: Record<string, unknown> }): boolean {
  return run.args.engine === FLOOR_ENGINE;
}

export function floorBackedRuns<Port extends FloorRunReads>(
  local: Port,
  floor: FloorRunReads,
): Port {
  const backed = Object.create(local) as Port;

  backed.getById = async (id) =>
    (await local.getById(id)) ?? (await floor.getById(id));
  backed.listStationRuns = async (runId) => {
    const visits = await local.listStationRuns(runId);

    return visits.length > 0 ? visits : floor.listStationRuns(runId);
  };
  backed.listSummaries = (query) => mergedSummaries(local, floor, query);

  return backed;
}

async function mergedSummaries(
  local: FloorRunReads,
  floor: FloorRunReads,
  query: AssemblyRunQuery,
): Promise<AssemblyRunSummary[]> {
  const [localRuns, floorRuns] = await Promise.all([
    local.listSummaries(query),
    floor.listSummaries(query).catch(floorListLost),
  ]);

  return newestFirst([...localRuns, ...floorRuns]).slice(
    0,
    query.limit ?? DEFAULT_LIST_LIMIT,
  );
}

/** A floor out of reach costs the list its floor runs, not the whole page: Postgres's runs are still worth showing. */
function floorListLost(err: unknown): AssemblyRunSummary[] {
  console.warn(
    `[floor] run list unavailable, listing Postgres runs only: ${String(err)}`,
  );

  return [];
}

function newestFirst<Run extends { id: string; createdAt: Date }>(
  runs: Run[],
): Run[] {
  return runs.sort(
    (a, b) =>
      b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id),
  );
}

let reader: FloorRunReader | undefined;

export function floorRunReader(): FloorRunReader {
  reader ??= new FloorRunReader(floorClient());

  return reader;
}

/** The port every run read goes through: Postgres alone on a deployment with no floor. */
export function runsReadingFloor(pool: Pool): AssemblyRunsPort {
  const local = new PgAssemblyRuns(pool);

  return floorConfigured() ? floorBackedRuns(local, floorRunReader()) : local;
}
