import { createProject, type Project } from "@re-cinq/lore-shared";
import { getPool } from "./db.js";

/**
 * Per-repo Project composition root for mcp-server. mcp is Postgres-only — the
 * memory backend defaults to Postgres so the Dgraph client is never touched; a
 * no-op satisfies the type and throws loudly if anything unexpectedly reaches
 * for Dgraph. createProject is async (adapters are dynamically imported, cached
 * after the first call), so this is cheap to call per request.
 */
const NO_OP_DGRAPH = {
  newTxn() {
    throw new Error("mcp-server has no Dgraph client (Postgres-only)");
  },
};

export function projectFor(repo: string): Promise<Project> {
  return createProject(repo, getPool(), NO_OP_DGRAPH, process.env);
}
