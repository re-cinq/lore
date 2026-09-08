// Project composition for a service that holds no Dgraph client: the graph is optional, so an unset LORE_DGRAPH_HTTP composes a stub naming the service if a port unexpectedly reaches for it.

import { createDgraphClient } from "../dgraph-client.js";
import { createProject } from "./lib/project-factory.js";
import type { ProjectProviders } from "./lib/providers.js";
import type { Project } from "./lib/project.js";
import type { PgPool } from "../memory-store.js";

export interface GraphlessDeps {
  pool: PgPool;
  /** Names the service in the throw a graph read would hit, e.g. `stations`. */
  service: string;
  providers: ProjectProviders;
}

export function createGraphlessProject(
  repo: string,
  { pool, service, providers }: GraphlessDeps,
): Promise<Project> {
  const dgraph = createDgraphClient(process.env) ?? {
    newTxn() {
      throw new Error(
        `${service} has no Dgraph client (LORE_DGRAPH_HTTP unset)`,
      );
    },
  };

  return createProject(repo, pool, dgraph, { providers });
}
