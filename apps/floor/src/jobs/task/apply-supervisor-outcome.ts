// Task-status application for an in-process assembly line outcome. Extracted
// from the worker's dark-factory branch when the assembly_line.start event
// handler became the executor entry: the handler's background continuation
// applies the terminal status, so this can no longer live as a worker-private
// helper. Unlike the old worker version it never throws — the "error" outcome
// writes the failed status directly (the worker's surrounding catch used to).

import { setStatus, insertEvent } from "./task-helpers.js";
import type { ProcessTaskViaSupervisorResult } from "./orchestrator.js";

/** The agent identity recorded on requeue — same derivation the worker uses at claim. */
const agentIdFor = (taskId: string): string => `lore-agent-${taskId.substring(0, 8)}`;

/** Injectable side-effects (the RecoverStaleDeps pattern) so the policy tests with plain fakes. */
export interface ApplyOutcomeDeps {
  setStatus: typeof setStatus;
  insertEvent: typeof insertEvent;
}

export async function applySupervisorOutcome(
  taskId: string,
  result: ProcessTaskViaSupervisorResult,
  deps: ApplyOutcomeDeps = { setStatus, insertEvent },
): Promise<void> {
  switch (result.outcome) {
    case "error":
      await deps.setStatus(taskId, "failed", {
        failure_reason: result.errorMessage ?? "supervisor failed",
      });
      await deps.insertEvent(taskId, "running", "failed", {
        error: result.errorMessage ?? "supervisor failed",
      });
      break;
    case "no_changes":
      await deps.setStatus(taskId, "completed");
      await deps.insertEvent(taskId, "running", "completed", { reason: "no_changes" });
      break;
    case "pr_created":
      // pushAndOpenPr already wrote pr-created status; record the event for completeness.
      await deps.insertEvent(taskId, "running", "pr-created", {
        pr_url: result.prUrl,
        pr_number: result.prNumber,
        via: "dark-factory-supervisor",
      });
      break;
    case "lease_held":
      // Another supervisor (likely a parallel pod) has the branch; back off to
      // queued so the next worker tick retries.
      await deps.setStatus(taskId, "queued", { agent_id: agentIdFor(taskId) });
      await deps.insertEvent(taskId, "running", "queued", { reason: "lease_held" });
      break;
    case "iteration_max":
      // Escalation Issue + Slack already fired via onIterationMaxExceeded inside
      // the orchestrator. Mark the task failed so it surfaces in the UI.
      await deps.setStatus(taskId, "failed", {
        failure_reason: result.errorMessage ?? "iteration_max",
      });
      await deps.insertEvent(taskId, "running", "failed", { reason: "iteration_max_exceeded" });
      break;
  }
}
