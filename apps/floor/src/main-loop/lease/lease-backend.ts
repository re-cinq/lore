import * as os from "node:os";
import * as path from "node:path";
import { FileLeaseBackend, type LeaseBackend } from "@re-cinq/lore-shared";
import { pipeline } from "../../kernel/queues.js";

/**
 * Selects the branch-lease backend for the current environment: Postgres in
 * cluster mode (LORE_DB_HOST set) via the shared `kernel/queues` singleton (one
 * DbLeaseBackend for the whole pod, per ADR-024), file-backed otherwise (local
 * runner, under ~/.lore/leases). Call sites inject the result where a branch
 * lease is still needed; the kernel itself never selects a backend.
 */
export function leaseBackendForEnv(): LeaseBackend {
  if (process.env.LORE_DB_HOST) {
    return pipeline().leases;
  }

  return new FileLeaseBackend(path.join(os.homedir(), ".lore", "leases"));
}
