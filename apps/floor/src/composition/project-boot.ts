import {
  createProject,
  createDgraphClient,
  type Project,
  type StationBackend,
} from "@re-cinq/lore-shared";
import { loadBuiltinAssemblyLines } from "@re-cinq/lore-assembly-lines";
import { getPool } from "../kernel/db.js";
import { HttpAgentApi } from "@re-cinq/lore-shared";
import { AssemblyLineStationBackend } from "../jobs/assembly-run/assembly-run-station-backend.js";
import { clusterAgent, pipeline, settings } from "../kernel/queues.js";
import { AgentCrStationBackend } from "../jobs/station/agent-cr-station-backend.js";
import { memoizePerKey } from "./memoize-per-key.js";

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
 * task types that have an assembly line run the Floor-side assembly line (one Agent CR
 * per node, #686); the rest run a single Agent. (The legacy LoreTask + Docker
 * backends were removed once agent-cr became the sole path.)
 *
 * Neither half holds anything that can create a CR. The Floor decides what to
 * dispatch and writes it down; a cluster-agent claims it and launches it in its
 * own cluster. What the Floor keeps is the READ — `HttpAgentApi` here is a
 * lister, used to ask whether a task's Agents are still alive.
 */
export function stationBackend(
  assemblyLineDefinitions: ReadonlySet<string> = new Set(),
): StationBackend {
  return new AgentCrStationBackend(
    // launch() = project.assemblyRuns.start(); the assembly_line.start event
    // handler launches the entry node — the walk advances on agent_node events.
    new AssemblyLineStationBackend(pipeline().assemblyRuns),
    assemblyLineDefinitions,
    pipeline().assemblyRuns,
    new HttpAgentApi(clusterAgent()),
    // The same read `advance.ts` resolves a node's required_tags from, so a
    // single visit and a line's visits are tagged from one source.
    (repo) => settings().rawSettings(repo),
  );
}

/** The builtin assembly line names (task types with an assembly line), loaded + cached once. */
let assemblyLineNamesCache: Promise<ReadonlySet<string>> | undefined;

export function assemblyLineNames(): Promise<ReadonlySet<string>> {
  return (assemblyLineNamesCache ??= loadBuiltinAssemblyLines().then(
    (m) => new Set(m.keys()),
  ));
}

/**
 * Memoized per repo. Every `createProject` builds a fresh `PlatformGitHub`, and
 * with it a fresh Octokit whose `createAppAuth` installation-token cache is
 * per-instance — so an unmemoized `projectFor` made the first GitHub call of
 * every Project sign a new App JWT and POST `/app/installations/{id}/access_tokens`
 * before doing any real work. The Floor asks for a Project ~50 times across its
 * handlers, several of them for the SAME repo inside one event (the review-verdict
 * path alone reaches for it three times), all serialized on the drain loop against
 * a rate-limited endpoint.
 *
 * Safe to hold: the pool is initialized once at boot, and the token cache inside
 * the adapter is what we are trying to keep, not something that goes stale.
 */
const cachedProject = memoizePerKey<Project>(async (repo) => {
  const dgraph = createDgraphClient() ?? NO_OP_DGRAPH;
  const station = stationBackend(await assemblyLineNames());

  return createProject(repo, getPool(), dgraph, process.env, {
    station,
    pipeline: pipeline(),
  });
});

export function projectFor(repo: string): Promise<Project> {
  return cachedProject(repo);
}
