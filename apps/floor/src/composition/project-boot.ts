import {
  createProject,
  createDgraphClient,
  selectStationBackend,
  type Project,
  type StationBackend,
} from "@re-cinq/lore-shared";
import { loadBuiltinWorkflows } from "@re-cinq/lore-runner";
import { getPool } from "../kernel/db.js";
import { K8sLoreTaskClient } from "../station/k8s-loretask.js";
import { DockerStation } from "../station/docker-station.js";
import { LocalStationCredentials } from "../station/local-station-credentials.js";
import { AgentBackend } from "../station/agent-backend.js";
import { KubeAgentApi } from "../station/kube-agent-api.js";
import { HttpContextSource } from "../station/http-context-source.js";
import { executionBackendForTask, repoBackendFromSettings } from "../station/execution-backend.js";
import { RoutingStationBackend } from "../station/routing-station-backend.js";
import {
  KubeTokenProvisioner,
  GithubTokenMinter,
  KubeSecretKeyWriter,
  KubeCatalogApi,
} from "../station/kube-token-provisioner.js";
import { GitHubPlatform } from "../platform/github.js";
import { GraphStationBackend } from "../assembly-line/graph-station-backend.js";
import { AgentCrStationBackend } from "../station/agent-cr-station-backend.js";
import { floorGraphRuntime } from "../assembly-line/floor-graph-run.js";

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
export function stationBackend(
  repoBackend?: string,
  workflows: ReadonlySet<string> = new Set(),
): StationBackend {
  if (selectStationBackend(process.env) !== "k8s") {
    return new DockerStation(new LocalStationCredentials(process.env), process.env);
  }
  // ADR-031 cutover (#688): route between the ai-agent-subsystem `Agent` path and legacy
  // LoreTask, honoring the per-repo opt-in (`repoBackend`). Both gates must be on for
  // agent-cr; the routing backend re-decides at isActive too, so the reaper probes the
  // same backend the task launched on.
  const agentBackend = new AgentBackend(
    new KubeAgentApi(),
    new HttpContextSource(),
    new KubeTokenProvisioner(
      new GithubTokenMinter(new GitHubPlatform()),
      new KubeSecretKeyWriter(),
      new KubeCatalogApi(),
    ),
  );
  // Within agent-cr: run the Floor-side workflow graph for task types that have one
  // (#686), else a single Agent. Both share the AgentBackend for CR dispatch.
  const agentCr = new AgentCrStationBackend(
    new GraphStationBackend(floorGraphRuntime(agentBackend)),
    agentBackend,
    workflows,
  );
  return new RoutingStationBackend(
    { "agent-cr": agentCr, loretask: new K8sLoreTaskClient() },
    () => executionBackendForTask({ repoBackend, env: process.env }),
  );
}

/** The builtin workflow names (task types with a graph), loaded + cached once. */
let workflowNamesCache: Promise<ReadonlySet<string>> | undefined;
function workflowNames(): Promise<ReadonlySet<string>> {
  return (workflowNamesCache ??= loadBuiltinWorkflows().then((m) => new Set(m.keys())));
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
  const station = stationBackend(await loadRepoBackend(repo), await workflowNames());
  return createProject(repo, getPool(), dgraph, process.env, { station });
}
