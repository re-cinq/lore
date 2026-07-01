import {
  createProject,
  createDgraphClient,
  type Project,
  type StationBackend,
} from "@re-cinq/lore-shared";
import { loadBuiltinWorkflows } from "@re-cinq/lore-runner";
import { getPool } from "../kernel/db.js";
import { AgentCrBackend } from "../jobs/station/agent-backend.js";
import { KubeAgentApi } from "../jobs/station/kube-agent-api.js";
import { HttpContextSource } from "../jobs/station/http-context-source.js";
import {
  KubeTokenProvisioner,
  GithubTokenMinter,
  KubeSecretKeyWriter,
  KubeCatalogApi,
} from "../jobs/station/kube-token-provisioner.js";
import { GitHubPlatform } from "../jobs/platform/github.js";
import { AssemblyLineStationBackend } from "../jobs/assembly-line/assembly-line-station-backend.js";
import { AgentCrStationBackend } from "../jobs/station/agent-cr-station-backend.js";
import { floorAssemblyLineRuntime } from "../jobs/assembly-line/floor-assembly-line-run.js";

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
 * The Station backend: the ai-agent-subsystem `Agent` path (ADR-031). Within it,
 * task types that have a workflow run the Floor-side assembly line (one Agent CR per
 * node, #686); the rest run a single Agent. Both share the AgentCrBackend for CR
 * dispatch. (The legacy LoreTask + Docker backends were removed once agent-cr
 * became the sole path.)
 */
export function stationBackend(
  workflows: ReadonlySet<string> = new Set(),
): StationBackend {
  const agentBackend = new AgentCrBackend(
    new KubeAgentApi(),
    new HttpContextSource(),
    new KubeTokenProvisioner(
      new GithubTokenMinter(new GitHubPlatform()),
      new KubeSecretKeyWriter(),
      new KubeCatalogApi(),
    ),
  );

  return new AgentCrStationBackend(
    new AssemblyLineStationBackend(floorAssemblyLineRuntime(agentBackend)),
    agentBackend,
    workflows,
  );
}

/** The builtin workflow names (task types with a assembly line), loaded + cached once. */
let workflowNamesCache: Promise<ReadonlySet<string>> | undefined;
function workflowNames(): Promise<ReadonlySet<string>> {
  return (workflowNamesCache ??= loadBuiltinWorkflows().then((m) => new Set(m.keys())));
}

export async function projectFor(repo: string): Promise<Project> {
  const dgraph = createDgraphClient() ?? NO_OP_DGRAPH;
  const station = stationBackend(await workflowNames());

  return createProject(repo, getPool(), dgraph, process.env, { station });
}
