/** Terminal Agent-run processing (ADR-031), event-driven off `kubernetes.agent.{succeeded,failed}` — never reads the cluster back, since dispatch is pull-based and the pod may have run somewhere this process can't reach. Per-outcome handling is split across agent-watcher-*.ts by job; this module holds the run-row bookkeeping and the phase dispatch that ties them together. */

import { resultTextFromOutput } from "@re-cinq/lore-assembly-lines";
import { assemblyLineNames } from "../lib/assembly-line-names.js";
import { pipeline, taskStore } from "../../kernel/queues.js";
import {
  parseReviewResult,
  decideTokenReclaim,
  runOutcomeFromTaskStatus,
  dispatchFacts,
  stationOutcomeForRunOutcome,
  type AgentTerminalReport,
} from "../lib/agent-watcher-logic.js";
import {
  type AgentContext,
} from "./agent-watcher-notify.js";
import { handleSucceededChanges } from "./agent-watcher-pr-delivery.js";
import { handleFailure } from "./agent-watcher-failure.js";
import { handleReviewVerdict } from "./agent-watcher-review.js";

import { cleanupPerTaskToken } from "../lib/per-task-token.js";

export { cleanupPerTaskToken } from "../lib/per-task-token.js";

/** Closes a single-CR task's open run rows from the task's post-handler status; `phase` disambiguates a Failed-but-still-`running` task so it closes `failed`, not `completed`. */
async function finishSingleCrRunRows(
  taskId: string,
  phase: string | undefined,
  failureReason?: string,
): Promise<void> {
  const open = (await pipeline().assemblyRuns.listForTask(taskId)).filter(
    (row) => ["queued", "running"].includes(row.status),
  );

  if (open.length === 0) {
    return;
  }

  const task = await taskStore().getById(taskId);
  const outcome = runOutcomeFromTaskStatus(task?.status ?? "completed", phase);

  await Promise.all(
    open.map(async (row) => {
      // Close the station-run row too, else it shows executing forever and the reaper stays interested.
      const nodes = await pipeline().assemblyRuns.listStationRuns(row.id);

      await Promise.all(
        nodes
          .filter((node) => node.outcome === null)
          .map((node) =>
            pipeline().assemblyRuns.finishStationRunOnce(
              node.id,
              stationOutcomeForRunOutcome(outcome),
              undefined,
              // `unknown`, not invented: failureClass is the closed taxonomy driving retry/dispatch gating.
              failureReason
                ? { failureClass: "unknown", failureDetail: failureReason }
                : undefined,
            ),
          ),
      );
      await pipeline().assemblyRuns.finish(row.id, outcome, failureReason);
    }),
  );
}

/** Prefer the run row over the Agent CR: it's neither cluster-local nor pruned an hour later. */
async function findCurrentRun(taskId: string) {
  const runs = await pipeline().assemblyRuns.listForTask(taskId);

  return (
    runs.find((row) => ["queued", "running"].includes(row.status)) ??
    runs.at(-1)
  );
}

/** Resolves the task + dispatch facts for a terminal report, or null when there's nothing here to reconcile (task gone/already settled, or the run row carries no dispatch facts). */
async function buildAgentTerminalContext(
  report: AgentTerminalReport,
): Promise<AgentContext | null> {
  const { taskId } = report;
  // DB-level re-entry guard: a task-less run (e.g. code-review) has nothing here to reconcile.
  const task = await taskStore().getById(taskId);

  if (!task || !["running", "queued"].includes(task.status)) {
    return null;
  }
  const run = await findCurrentRun(taskId);
  const facts = dispatchFacts(run ?? null, task);

  if (!facts) {
    return null;
  }

  return {
    taskId,
    ...facts,
    output: resultTextFromOutput(report.output ?? ""),
  };
}

/** No `status.prUrl` guard: the DB guard in `buildAgentTerminalContext` is the same gate, read from a source that survives the pod. */
async function applySucceededPhase(ctx: AgentContext): Promise<void> {
  if (ctx.taskType !== "review") {
    await handleSucceededChanges(ctx);

    return;
  }
  // Review verdict (parsed from the reported output — Agent has no reviewResult field).
  const reviewResult = parseReviewResult(ctx.output);

  if (reviewResult) {
    await handleReviewVerdict(ctx, reviewResult);
  }
}

async function applyTerminalPhaseEffects(
  ctx: AgentContext,
  report: AgentTerminalReport,
): Promise<void> {
  const { phase } = report;

  if (phase === "Succeeded") {
    await applySucceededPhase(ctx);

    return;
  }

  // Only "Succeeded" and "Failed" ever reach here (validated at the event boundary); the "Succeeded" branch above already returned.
  if (report.failureReason) {
    await handleFailure(ctx, report.failureReason);
  }
}

/** Single-CR task: close its run row + reclaim its token here (#784); station lines do both at line completion. */
async function settleSingleCrTask(
  taskId: string,
  taskType: string,
  phase: string | undefined,
  failureReason: string | undefined,
): Promise<void> {
  const isAssemblyLineTask = (await assemblyLineNames()).has(taskType);

  if (!isAssemblyLineTask) {
    await finishSingleCrRunRows(taskId, phase, failureReason);
  }

  if (decideTokenReclaim({ phase, isAssemblyLineTask })) {
    await cleanupPerTaskToken(taskId);
  }
}

/** Settles one terminal Agent run from its event report; node CRs never arrive here (routed to `kubernetes.agent_node.*` instead). */
export async function processAgentTerminal(
  report: AgentTerminalReport,
): Promise<void> {
  const ctx = await buildAgentTerminalContext(report);

  if (!ctx) {
    return;
  }

  await applyTerminalPhaseEffects(ctx, report);
  await settleSingleCrTask(
    ctx.taskId,
    ctx.taskType,
    report.phase,
    report.failureReason,
  );
}
