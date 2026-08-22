import {
  createProject,
  createDgraphClient,
  type Project,
} from "@re-cinq/lore-shared";
import { getPool } from "@re-cinq/lore-server-core/platform/db.js";
import { pipelineRepositories } from "./pipeline-boot.js";

/**
 * Per-repo Project composition root for the Lore API. The memory backend defaults
 * to Postgres, but `project.trace` reads the spec-traceability graph — so when
 * `LORE_DGRAPH_HTTP` is configured we hand createProject a real Dgraph client.
 * When it is unset, the no-op satisfies the type and throws loudly if anything
 * unexpectedly reaches for Dgraph. createProject is async (adapters dynamically
 * imported, cached after the first call), so this is cheap to call per request.
 */
const NO_OP_DGRAPH = {
  newTxn() {
    throw new Error("lore-api has no Dgraph client (LORE_DGRAPH_HTTP unset)");
  },
};

export function projectFor(repo: string): Promise<Project> {
  const dgraph = createDgraphClient(process.env) ?? NO_OP_DGRAPH;

  return createProject(repo, getPool(), dgraph, process.env, {
    pipeline: pipelineRepositories(),
  });
}
