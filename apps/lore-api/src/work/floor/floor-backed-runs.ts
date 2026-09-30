// The run reads, answered from Postgres first and from the external floor when Postgres has no such run. One decorator on the port, so every route and the live socket see a floor run without knowing there are two engines.
import type { Pool } from "pg";
import {
  floorClient,
  floorConfigured,
} from "@re-cinq/lore-shared/floor/floor-client.js";
import { PgAssemblyRuns } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-pg.js";
import type { AssemblyRunsPort } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-port.js";
import { FloorRunReader } from "./floor-run-reader.js";

export type FloorRunReads = Pick<
  AssemblyRunsPort,
  "getById" | "listStationRuns"
>;

export const FLOOR_ENGINE = "floor";

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

  return backed;
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
