import {
  createProject,
  createDgraphClient,
  type Project,
  type StationBackend,
} from "@re-cinq/lore-shared";
import { loadBuiltinAssemblyLines } from "@re-cinq/lore-assembly-lines";
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
import { PlatformGitHub } from "@re-cinq/lore-shared/project/lib/platform-github.js";
import { AssemblyLineStationBackend } from "../jobs/assembly-line/assembly-line-station-backend.js";
import { assemblyLines } from "../kernel/queues.js";
import { AgentCrStationBackend } from "../jobs/station/agent-cr-station-backend.js";

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
 * task types that have an assembly line run the Floor-side assembly line (one Agent CR per
 * node, #686); the rest run a single Agent. Both share the AgentCrBackend for CR
 * dispatch. (The legacy LoreTask + Docker backends were removed once agent-cr
 * became the sole path.)
 */
export function agentCrBackend(): AgentCrBackend {
  return new AgentCrBackend(
    new KubeAgentApi(),
    new HttpContextSource(),
    new KubeTokenProvisioner(
      new GithubTokenMinter(new PlatformGitHub(process.env)),
      new KubeSecretKeyWriter(),
      new KubeCatalogApi(),
    ),
  );
}

export function stationBackend(
  assemblyLineDefinitions: ReadonlySet<string> = new Set(),
): StationBackend {
  const agentBackend = agentCrBackend();

  return new AgentCrStationBackend(
    // launch() = project.assemblyLines.start(); the assembly_line.start event
    // handler runs the actual walk via floorAssemblyLineRuntime(agentCrBackend()).
    new AssemblyLineStationBackend(assemblyLines()),
    agentBackend,
    assemblyLineDefinitions,
    assemblyLines(),
  );
}

/** The builtin assembly line names (task types with an assembly line), loaded + cached once. */
let assemblyLineNamesCache: Promise<ReadonlySet<string>> | undefined;

export function assemblyLineNames(): Promise<ReadonlySet<string>> {
  return (assemblyLineNamesCache ??= loadBuiltinAssemblyLines().then(
    (m) => new Set(m.keys()),
  ));
}

export async function projectFor(repo: string): Promise<Project> {
  const dgraph = createDgraphClient() ?? NO_OP_DGRAPH;
  const station = stationBackend(await assemblyLineNames());

  return createProject(repo, getPool(), dgraph, process.env, { station });
}
