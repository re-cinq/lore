// Per-repo Project composition for the stations service — deliberately thinner than the Floor's (no station backend, no assembly-line definitions): a service-endpoint station does WORK, it doesn't dispatch other stations; launching an Agent CR is cluster authority and stays on the Floor.

import {
  createProject,
  createDgraphClient,
  type Project,
} from "@re-cinq/lore-shared";
import { getPool } from "@re-cinq/lore-shared/db/pg-pool.js";
import { pipelineRepositories } from "./queues.js";

// Satisfies the type and throws loudly if a station unexpectedly reaches for the graph — no station here reads it today.
const NO_OP_DGRAPH = {
  newTxn() {
    throw new Error("stations has no Dgraph client (LORE_DGRAPH_HTTP unset)");
  },
};

export function projectFor(repo: string): Promise<Project> {
  const dgraph = createDgraphClient(process.env) ?? NO_OP_DGRAPH;

  return createProject(repo, getPool(), dgraph, process.env, {
    pipeline: pipelineRepositories(),
  });
}
