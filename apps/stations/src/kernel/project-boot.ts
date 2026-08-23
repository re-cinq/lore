// Per-repo Project composition for the stations service.
//
// Deliberately thinner than the Floor's: no station backend and no assembly-line
// definitions, because a service-endpoint station does WORK, it does not
// dispatch other stations. Anything here that wanted to launch an Agent CR
// would be in the wrong process — that is cluster authority, and it stays on
// the Floor.

import {
  createProject,
  createDgraphClient,
  type Project,
} from "@re-cinq/lore-shared";
import { getPool } from "./db.js";
import { pipelineRepositories } from "./queues.js";

/** Satisfies the type and throws loudly if a station unexpectedly reaches for
 *  the graph — no station here reads it today. */
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
