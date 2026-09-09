// Per-repo Project composition for the stations service — deliberately thinner than the Floor's (no station backend, no assembly-line definitions): a service-endpoint station does WORK, it doesn't dispatch other stations; launching an Agent CR is cluster authority and stays on the Floor.

import { createGraphlessProject } from "@re-cinq/lore-shared/project/graphless-project.js";
import type { Project } from "@re-cinq/lore-shared";
import { getPool } from "@re-cinq/lore-shared/db/pg-pool.js";
import { pipelineRepositories } from "./queues.js";

// No station here reads the graph today, so an unset LORE_DGRAPH_HTTP throws loudly rather than composing a client.
export function projectFor(repo: string): Promise<Project> {
  return createGraphlessProject(repo, {
    pool: getPool(),
    service: "stations",
    providers: { pipeline: pipelineRepositories() },
  });
}
