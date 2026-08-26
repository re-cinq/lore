import {
  createProject,
  createDgraphClient,
  type Project,
  type StationBackend,
} from "@re-cinq/lore-shared";
import { loadBuiltinAssemblyLines } from "@re-cinq/lore-assembly-lines";
import { getPool } from "../kernel/db.js";
import { AgentCrBackend } from "@re-cinq/lore-shared/cluster/agent-backend.js";
import { HttpContextSource } from "../jobs/station/http-context-source.js";
import { HttpAgentApi, HttpTokenProvisioner } from "@re-cinq/lore-shared";
import { AssemblyLineStationBackend } from "../jobs/assembly-run/assembly-run-station-backend.js";
import { clusterAgent, pipeline } from "../kernel/queues.js";
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
  // Both halves now go through the cluster agent: the Floor decides what to
  // dispatch and provision, the agent performs it. No Kubernetes client here.
  return new AgentCrBackend(
    new HttpAgentApi(clusterAgent()),
    new HttpContextSource(),
    new HttpTokenProvisioner(clusterAgent()),
  );
}

export function stationBackend(
  assemblyLineDefinitions: ReadonlySet<string> = new Set(),
): StationBackend {
  const agentBackend = agentCrBackend();

  return new AgentCrStationBackend(
    // launch() = project.assemblyRuns.start(); the assembly_line.start event
    // handler launches the entry node — the walk advances on agent_node events.
    new AssemblyLineStationBackend(pipeline().assemblyRuns),
    agentBackend,
    assemblyLineDefinitions,
    pipeline().assemblyRuns,
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

  return createProject(repo, getPool(), dgraph, process.env, {
    station,
    pipeline: pipeline(),
  });
}
