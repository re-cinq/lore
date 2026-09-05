/** Per-repo `Project` (pool + Dgraph, memoized). Substrate, so the job domains can reach it without importing the wiring root: only the station backend is INJECTED, by `composition/`, which is the half that has to know about jobs. */

import {
  createProject,
  createDgraphClient,
  type Project,
  type StationBackend,
} from "@re-cinq/lore-shared";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { getPool } from "./db.js";
import { pipeline } from "./queues.js";
import { memoizePerKey } from "./memoize-per-key.js";

const NO_OP_DGRAPH = {
  newTxn() {
    throw new Error("Dgraph not configured");
  },
};

export type StationBackendFactory = () => Promise<StationBackend>;

let buildStationBackend: StationBackendFactory | undefined;

/** Called once by the composition root before any handler runs. */
export function useStationBackend(factory: StationBackendFactory): void {
  buildStationBackend = factory;
}

/** Test seam: forget the registered factory so a suite can start from the unwired state. */
export function resetStationBackend(): void {
  buildStationBackend = undefined;
}

const cachedProject = memoizePerKey<Project>(async (repo) => {
  enforceTrue(
    buildStationBackend !== undefined,
    Error,
    "projectFor: no station backend registered — the composition root must call useStationBackend() before a handler runs",
  );
  const dgraph = createDgraphClient() ?? NO_OP_DGRAPH;
  const station = await buildStationBackend();

  return createProject(repo, getPool(), dgraph, {
    providers: { station, pipeline: pipeline() },
  });
});

export function projectFor(repo: string): Promise<Project> {
  return cachedProject(repo);
}

/** The wired station backend, for the few callers that need it outside a Project. */
export async function stationBackendNow(): Promise<StationBackend> {
  enforceTrue(
    buildStationBackend !== undefined,
    Error,
    "stationBackendNow: no station backend registered — the composition root must call useStationBackend() first",
  );

  return buildStationBackend();
}
