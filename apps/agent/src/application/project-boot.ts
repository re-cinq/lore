import { createProject, createDgraphClient, type Project } from "@re-cinq/lore-shared";
import { getPool } from "../data/db.js";
import { K8sLoreTaskClient } from "../adapters/k8s-loretask.js";

/**
 * Per-repo Project composition root for the agent. Builds from the agent's
 * Postgres pool + the optional Dgraph client (no-op when unconfigured). The
 * k8s/llm provider ports (cluster/direct agent modes) are injected here as the
 * migration reaches the worker/CR call sites. createProject is async (adapters
 * dynamically imported, cached after the first call), so per-repo is cheap.
 */
const NO_OP_DGRAPH = {
  newTxn() {
    throw new Error("Dgraph not configured");
  },
};

export function projectFor(repo: string): Promise<Project> {
  const dgraph = createDgraphClient() ?? NO_OP_DGRAPH;
  return createProject(repo, getPool(), dgraph, process.env, { k8s: new K8sLoreTaskClient() });
}
