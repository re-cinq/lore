import {
  createProject,
  createDgraphClient,
  selectStationBackend,
  type Project,
  type StationBackend,
} from "@re-cinq/lore-shared";
import { getPool } from "../data/db.js";
import { K8sLoreTaskClient } from "../adapters/k8s-loretask.js";
import { DockerStation } from "../adapters/docker-station.js";
import { LocalStationCredentials } from "../adapters/local-station-credentials.js";

/**
 * Per-repo Project composition root for the agent. Builds from the agent's
 * Postgres pool + the optional Dgraph client (no-op when unconfigured). The
 * k8s/llm provider ports (cluster/direct agent modes) are injected here as the
 * migration reaches the worker/CR call sites. createProject is async (adapters
 * dynamically imported, cached after the first call), so per-repo is cheap.
 */
const NO_OP_DGRAPH = {
  newTxn() {
    throw new Error("Dgraph not configured");
  },
};

/**
 * Pick the Station backend (ADR-028): K8s on the cluster, Docker locally,
 * chosen by selectStationBackend(env). `inprocess` still needs a container for
 * non-planning cluster tasks (impl/review), so it resolves to Docker here; the
 * worker handles the inprocess planning/finalize routing separately.
 */
export function stationBackend(): StationBackend {
  return selectStationBackend(process.env) === "k8s"
    ? new K8sLoreTaskClient()
    : new DockerStation(new LocalStationCredentials(process.env), process.env);
}

export function projectFor(repo: string): Promise<Project> {
  const dgraph = createDgraphClient() ?? NO_OP_DGRAPH;
  return createProject(repo, getPool(), dgraph, process.env, { station: stationBackend() });
}
