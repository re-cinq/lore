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

/** Per-repo Project: pool + Dgraph (no-op if unconfigured); memoized per repo. */
const NO_OP_DGRAPH = {
  newTxn() {
    throw new Error("Dgraph not configured");
  },
};

/** Station backend (ADR-031): Agent CR path; Floor reads via HttpAgentApi lister. */
export function stationBackend(
  assemblyLineDefinitions: ReadonlySet<string> = new Set(),
): StationBackend {
  return new AgentCrStationBackend({
    // launch() = assemblyRuns.start() → assembly_line.start event → walk on agent_node events.
    assemblyLine: new AssemblyLineStationBackend(pipeline().assemblyRuns),
    assemblyLineNames: assemblyLineDefinitions,
    assemblyRuns: pipeline().assemblyRuns,
    agents: new HttpAgentApi(clusterAgent()),
    // Same source as advance.ts reads for required_tags.
    repoSettings: (repo) => settings().rawSettings(repo),
  });
}

/** The builtin assembly line names (task types with an assembly line), loaded + cached once. */
let assemblyLineNamesCache: Promise<ReadonlySet<string>> | undefined;

export function assemblyLineNames(): Promise<ReadonlySet<string>> {
  return (assemblyLineNamesCache ??= loadBuiltinAssemblyLines().then(
    (m) => new Set(m.keys()),
  ));
}

/** Memoized per repo: fresh Octokit per project, so memoization preserves token cache across calls. */
const cachedProject = memoizePerKey<Project>(async (repo) => {
  const dgraph = createDgraphClient() ?? NO_OP_DGRAPH;
  const station = stationBackend(await assemblyLineNames());

  return createProject(repo, getPool(), dgraph, {
    providers: { station, pipeline: pipeline() },
  });
});

export function projectFor(repo: string): Promise<Project> {
  return cachedProject(repo);
}
