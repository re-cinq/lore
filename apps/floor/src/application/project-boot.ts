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
import { executionBackendForTask, repoBackendFromSettings } from "../adapters/execution-backend.js";
import { RoutingStationBackend } from "../adapters/routing-station-backend.js";
import {
  KubeTokenProvisioner,
  GithubTokenMinter,
  KubeSecretKeyWriter,
  KubeCatalogApi,
} from "../adapters/kube-token-provisioner.js";
import { GitHubPlatform } from "../adapters/github.js";

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
export function stationBackend(repoBackend?: string): StationBackend {
  if (selectStationBackend(process.env) !== "k8s") {
    return new DockerStation(new LocalStationCredentials(process.env), process.env);
  }
  // ADR-031 cutover (#688): route per task between the ai-agent-subsystem `Agent` path
  // and legacy LoreTask, honoring the per-repo opt-in (`repoBackend`) + the graded-rollout
  // percentage. Both gates must be on for agent-cr; the routing backend re-decides at
  // isActive too, so the reaper probes the same backend the task launched on.
  const agentCr = new AgentBackend(
    new KubeAgentApi(),
    new HttpContextSource(),
    new KubeTokenProvisioner(
      new GithubTokenMinter(new GitHubPlatform()),
      new KubeSecretKeyWriter(),
      new KubeCatalogApi(),
    ),
  );
  return new RoutingStationBackend(
    { "agent-cr": agentCr, loretask: new K8sLoreTaskClient() },
    (taskId) => executionBackendForTask({ repoBackend, taskId, env: process.env }),
  );
}

/** The repo's `dark_factory.execution.backend` opt-in for the cutover router (#688). */
export async function loadRepoBackend(repo: string): Promise<string | undefined> {
  try {
    const { rows } = await getPool().query<{ settings: unknown }>(
      `SELECT settings FROM lore.repos WHERE full_name = $1`,
      [repo],
    );
    return repoBackendFromSettings(rows[0]?.settings);
  } catch {
    return undefined;
  }
}

export async function projectFor(repo: string): Promise<Project> {
  const dgraph = createDgraphClient() ?? NO_OP_DGRAPH;
  const station = stationBackend(await loadRepoBackend(repo));
  return createProject(repo, getPool(), dgraph, process.env, { station });
}
