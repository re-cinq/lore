/** The wiring root: builds the station backend out of the job domains and hands it to the kernel, which owns `projectFor` but must not import jobs to get one. */

import type { StationBackend } from "@re-cinq/lore-shared";
import { HttpAgentApi } from "@re-cinq/lore-shared";
import { AssemblyLineStationBackend } from "../work/assembly-run/assembly-run-station-backend.js";
import { AgentCrStationBackend } from "../work/station/agent-cr-station-backend.js";
import { clusterAgent, pipeline, settings } from "../outbound/queues.js";
import { useStationBackend } from "../outbound/project-boot.js";
import { assemblyLineNames } from "../work/lib/assembly-line-names.js";

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
    // Same source as advance-line.ts reads for required_tags.
    repoSettings: (repo) => settings().rawSettings(repo),
  });
}

/** Every entry point calls this before starting work; `projectFor` throws until it has. */
export function wireProject(): void {
  useStationBackend(async () => stationBackend(await assemblyLineNames()));
}
