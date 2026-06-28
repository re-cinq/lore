import * as os from "node:os";
import * as path from "node:path";
import {
  DbLeaseBackend,
  FileLeaseBackend,
  type LeaseBackend,
} from "@re-cinq/lore-shared";
import { getPool } from "../kernel/db.js";

/**
 * Selects the branch-lease backend for the current environment: Postgres in
 * cluster mode (LORE_DB_HOST set), file-backed otherwise (local runner, under
 * ~/.lore/leases). The agent call sites inject the result into the runner's
 * runSupervisor; the kernel itself never selects a backend.
 */
export function leaseBackendForEnv(): LeaseBackend {
  if (process.env.LORE_DB_HOST) {
    return new DbLeaseBackend(getPool());
  }
  return new FileLeaseBackend(path.join(os.homedir(), ".lore", "leases"));
}
