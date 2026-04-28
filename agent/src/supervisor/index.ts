import * as os from "node:os";
import * as path from "node:path";
import { getPool } from "../db.js";
import { writeAuditLog } from "../lib/audit.js";
import {
  DbLeaseBackend,
  FileLeaseBackend,
  type LeaseBackend,
} from "./lease.js";

export interface SupervisorOptions {
  taskId: string;
  branchName: string;
  workflowName: string;
  /**
   * Working directory for git operations. The graph executor (T014) uses
   * this; the skeleton ignores it.
   */
  gitDir?: string;
  /**
   * Identifier recorded as the lease holder. Defaults to `$HOSTNAME` /
   * `os.hostname()` for cluster pods, falling back to `local-<pid>` for
   * local-runner spawns where multiple workers share a host.
   */
  holder?: string;
  /**
   * Override the auto-selected lease backend. Used by tests; production
   * callers should rely on {@link leaseBackendForEnv}.
   */
  leaseBackend?: LeaseBackend;
}

export type SupervisorReason =
  | "lease_held"
  | "completed"
  | "executor_pending";

export interface SupervisorResult {
  ranWork: boolean;
  reason: SupervisorReason;
  currentHolder?: string;
}

function defaultHolder(): string {
  return process.env.HOSTNAME || os.hostname() || `local-${process.pid}`;
}

/**
 * Selects the lease backend at module load. DB-backed when LORE_DB_HOST
 * is configured (cluster mode), file-backed otherwise (local-runner
 * mode, lease records under `~/.lore/leases/`).
 */
export function leaseBackendForEnv(): LeaseBackend {
  if (process.env.LORE_DB_HOST) {
    return new DbLeaseBackend(getPool());
  }
  return new FileLeaseBackend(path.join(os.homedir(), ".lore", "leases"));
}

/**
 * Walk a workflow graph for one task. **Skeleton.** The actual graph
 * executor lands in T014 (Phase 3). Today this validates the lease
 * lifecycle: acquire → (executor stub, no work) → release. A second
 * supervisor that finds the lease held exits cleanly with `lease_held`.
 *
 * Resume semantics are not exercised here; once T014 lands, the
 * executor reads the last `Lore-Stage:` trailer from `git log` on the
 * branch and skips already-completed phases (FR1.2).
 */
export async function runSupervisor(
  opts: SupervisorOptions,
): Promise<SupervisorResult> {
  const holder = opts.holder ?? defaultHolder();
  const backend = opts.leaseBackend ?? leaseBackendForEnv();

  const lease = await backend.acquire(
    opts.branchName,
    opts.taskId,
    holder,
  );
  if (!lease.acquired) {
    console.log(
      `[supervisor] Lease for ${opts.branchName} held by ${
        lease.currentHolder ?? "unknown"
      }; exiting`,
    );
    return {
      ranWork: false,
      reason: "lease_held",
      currentHolder: lease.currentHolder,
    };
  }

  if (lease.tookOverFrom) {
    console.log(
      `[supervisor] Took over lease on ${opts.branchName} from previous holder ${lease.tookOverFrom} (lease had expired)`,
    );
    // Audit log requires a DB connection. In local-runner mode (no
    // LORE_DB_HOST) the file-backed lease has no audit destination —
    // local-tasks.json is the local trail. Skip silently.
    if (process.env.LORE_DB_HOST) {
      try {
        await writeAuditLog({
          event_type: "lease_expired",
          task_id: opts.taskId,
          payload: {
            branch_name: opts.branchName,
            previous_holder: lease.tookOverFrom,
            new_holder: holder,
            reason: "takeover_at_acquire",
          },
        });
      } catch (err) {
        console.warn(
          "[supervisor] Failed to write takeover audit entry:",
          (err as Error).message,
        );
      }
    }
  }

  try {
    // T014 fills this with: load workflow YAML, walk graph, commit
    // stage trailers per node, refresh lease before each node.
    console.log(
      `[supervisor] Acquired lease on ${opts.branchName} as ${holder}; ` +
        `workflow=${opts.workflowName} (graph executor pending T014)`,
    );
    return { ranWork: true, reason: "executor_pending" };
  } finally {
    await backend.release(opts.branchName, holder);
  }
}
