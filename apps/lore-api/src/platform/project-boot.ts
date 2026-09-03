import {
  createProject,
  createDgraphClient,
  type Project,
} from "@re-cinq/lore-shared";
import { getPool } from "@re-cinq/lore-server-core/platform/db.js";
import { pipelineRepositories } from "./pipeline-boot.js";

/** No-op Dgraph when LORE_DGRAPH_HTTP is unset (trace reads the graph when configured). */
const NO_OP_DGRAPH = {
  newTxn() {
    throw new Error("lore-api has no Dgraph client (LORE_DGRAPH_HTTP unset)");
  },
};

export function projectFor(repo: string): Promise<Project> {
  const dgraph = createDgraphClient(process.env) ?? NO_OP_DGRAPH;

  return createProject(repo, getPool(), dgraph, {
    providers: { pipeline: pipelineRepositories() },
  });
}
