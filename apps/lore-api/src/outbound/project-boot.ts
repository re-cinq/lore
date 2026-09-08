import { createGraphlessProject } from "@re-cinq/lore-shared/project/graphless-project.js";
import type { Project } from "@re-cinq/lore-shared";
import { getPool } from "@re-cinq/lore-server-core/platform/db.js";
import { pipelineRepositories } from "./pipeline-boot.js";

/** No Dgraph when LORE_DGRAPH_HTTP is unset (trace reads the graph when configured). */
export function projectFor(repo: string): Promise<Project> {
  return createGraphlessProject(repo, {
    pool: getPool(),
    service: "lore-api",
    providers: { pipeline: pipelineRepositories() },
  });
}
