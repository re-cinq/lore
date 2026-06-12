import * as os from "node:os";
import * as path from "node:path";
import { getPool } from "../platform/db.js";
import { writeAuditLog } from "../lib/audit.js";
import {
  DbLeaseBackend,
  FileLeaseBackend,
  type LeaseBackend,
} from "@re-cinq/lore-shared";
import {
  executeGraph,
  IterationMaxExceededError,
  type ExecutionSummary,
  type NodeHandlers,
} from "./graph-executor.js";
import type { Workflow } from "../workflow/loader.js";

export interface SupervisorOptions {
  taskId: string;
  branchName: string;
  workflowName: string;
  /**
   * Working directory for git operations. Required when `workflow` and
   * `handlers` are provided (i.e. real graph execution). Optional when
   * only the lease lifecycle is being exercised (tests).
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
  /**
   * Pre-loaded workflow definition. When provided alongside `handlers`,
   * the supervisor walks the graph instead of returning early with
   * `executor_pending`. Production callers load the workflow via
   * `loadWorkflowDir` and pick by `workflowName`.
   */
  workflow?: Workflow;
  /**
   * Per-node handlers. Required to walk the graph. Production callers
   * use `createProductionHandlers()` from `./handlers.js`.
   */
  handlers?: NodeHandlers;
  /**
   * Optional escalation hook fired when the graph aborts on iteration
   * max. Wired by the orchestrator to call `escalate()` from
   * `lib/escalation.ts` so a stuck task produces a `needs-human-help`
   * Issue + Slack ping with full context (FR3.8).
   */
  onIterationMaxExceeded?: (info: {
    workflowName: string;
    fromNode: string;
    toNode: string;
    iterationMax: number;
    taskId: string;
    branchName: string;
  }) => Promise<void>;
}

export type SupervisorReason =
  | "lease_held"
  | "completed"
  | "executor_pending"
  | "iteration_max_exceeded"
  | "executor_error";

export interface SupervisorResult {
  ranWork: boolean;
  reason: SupervisorReason;
  currentHolder?: string;
  summary?: ExecutionSummary;
  errorMessage?: string;
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
    // When a caller supplies both a loaded workflow and a handler set,
    // run the graph end-to-end. Otherwise return early — the lease
    // lifecycle alone is exercised (used by tests of the lease side).
    if (!opts.workflow || !opts.handlers) {
      console.log(
        `[supervisor] Acquired lease on ${opts.branchName} as ${holder}; ` +
          `workflow=${opts.workflowName} (executor not configured — lease lifecycle only)`,
      );
      return { ranWork: true, reason: "executor_pending" };
    }
    if (!opts.gitDir) {
      throw new Error(
        "[supervisor] gitDir required when workflow + handlers are provided",
      );
    }

    console.log(
      `[supervisor] Walking workflow ${opts.workflowName} on ${opts.branchName} as ${holder}`,
    );
    try {
      const summary = await executeGraph({
        workflow: opts.workflow,
        taskId: opts.taskId,
        branchName: opts.branchName,
        gitDir: opts.gitDir,
        holder,
        leaseBackend: backend,
        handlers: opts.handlers,
        onIterationMaxExceeded: opts.onIterationMaxExceeded,
      });
      return { ranWork: true, reason: "completed", summary };
    } catch (err) {
      if (err instanceof IterationMaxExceededError) {
        return {
          ranWork: true,
          reason: "iteration_max_exceeded",
          errorMessage: err.message,
        };
      }
      console.error(
        `[supervisor] executeGraph threw on ${opts.branchName}:`,
        (err as Error).message,
      );
      return {
        ranWork: true,
        reason: "executor_error",
        errorMessage: (err as Error).message,
      };
    }
  } finally {
    await backend.release(opts.branchName, holder);
  }
}
