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
import { AgentBackend } from "../adapters/agent-backend.js";
import { KubeAgentApi } from "../adapters/kube-agent-api.js";
import { HttpContextSource } from "../adapters/http-context-source.js";
import { decideExecutionBackend } from "../adapters/execution-backend.js";

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
  if (selectStationBackend(process.env) !== "k8s") {
    return new DockerStation(new LocalStationCredentials(process.env), process.env);
  }
  // ADR-031 cutover: on the cluster, route to the ai-agent-subsystem `Agent` path
  // when the cluster gate is on. The per-repo gate + graded rollout are threaded at
  // dispatch by the cutover (#688); at this scope the cluster gate is the only
  // signal, so it doubles as the repo opt-in.
  const clusterEnabled = process.env.LORE_AGENT_CR_BACKEND_ENABLED === "true";
  const backend = decideExecutionBackend({
    clusterEnabled,
    repoBackend: clusterEnabled ? "agent-cr" : "loretask",
  });
  return backend === "agent-cr"
    ? new AgentBackend(new KubeAgentApi(), new HttpContextSource())
    : new K8sLoreTaskClient();
}

export function projectFor(repo: string): Promise<Project> {
  const dgraph = createDgraphClient() ?? NO_OP_DGRAPH;
  return createProject(repo, getPool(), dgraph, process.env, { station: stationBackend() });
}
