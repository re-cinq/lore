// What happens when the PR CANNOT be opened. Separate from agent-watcher-pr-delivery.ts, which is the success path: the two share a trigger, not a job, and only this half reaches a human.

import { cleanupPerTaskToken } from "./per-task-token.js";
import { errorMessage } from "@re-cinq/lore-shared";
import { startEscalationLine } from "@re-cinq/lore-shared/escalation/start-escalation-line.js";
import { taskStore, pipeline } from "../../outbound/queues.js";
import type { AgentContext } from "./agent-watcher-notify.js";

/** No commits / a pre-existing PR are the two createPR failures a human, not a retry, resolves — escalate via the ADR-016 line (had no caller between #805 and now); any other failure is left for the next event. */

export async function handlePrCreationFailure(
  ctx: AgentContext,
  err: unknown,
): Promise<void> {
  const { taskId } = ctx;
  const msg = String(errorMessage(err) || err);

  console.error(`[agent-watcher] Failed to create PR for ${taskId}: ${msg}`);
  const isEmptyDiff = /No commits between/i.test(msg);
  const isPrExists = /A pull request already exists/i.test(msg);

  if (!(isEmptyDiff || isPrExists)) {
    return;
  }
  const reason = isEmptyDiff ? "no-code-changes" : "pr-already-exists";

  await markNeedsHuman(taskId, reason, msg);
  await escalate(ctx, reason, msg);

  await cleanupPerTaskToken(taskId);
  console.log(`[agent-watcher] Marked ${taskId} needs-human-help (${reason})`);
}

/** Both writes are `.catch`-swallowed: the escalation that follows is what actually reaches a human, and a status write failing must not cost the Issue. */
async function markNeedsHuman(
  taskId: string,
  reason: string,
  msg: string,
): Promise<void> {
  await taskStore()
    .setStatus(taskId, "needs-human-help", {
      failure_reason: `createPR failed: ${reason}. ${msg.substring(0, 300)}`,
    })
    .catch(() => {});
  await taskStore()
    .recordEvent(taskId, "running", "needs-human-help", {
      reason,
      detected_by: "agent-watcher",
      error: msg.substring(0, 500),
    })
    .catch(() => {});
}

/** Files the escalation Issue. */
async function escalate(
  ctx: AgentContext,
  reason: string,
  msg: string,
): Promise<void> {
  const { taskId, targetRepo, branch } = ctx;

  await startEscalationLine(
    { id: taskId, repo: targetRepo, branch },
    escalationPayload(reason, msg),
    escalationRunPort(),
  ).catch((err) =>
    console.error(
      `[agent-watcher] escalation for ${taskId} not started:`,
      (err as Error).message,
    ),
  );
}

/** The reason is SPECIFIC rather than a generic panic, so the Issue title does not send a human hunting for a crash that never happened. */
function escalationPayload(
  reason: string,
  msg: string,
): Parameters<typeof startEscalationLine>[1] {
  return {
    reason:
      reason === "no-code-changes" ? "no_code_changes" : "pr_already_exists",
    diagnostic: `createPR failed: ${reason}. ${msg.substring(0, 500)}`,
  };
}

/** The assembly-run seam the escalation line needs: open-subject lookup, subject count, and the start itself. */
function escalationRunPort() {
  return {
    findOpenBySubject: (repo: string, key: string) =>
      pipeline().assemblyRuns.findOpenBySubject(repo, key),
    countBySubject: (repo: string, key: string) =>
      pipeline().assemblyRuns.countBySubject(repo, key),
    start: (
      input: Parameters<
        ReturnType<typeof pipeline>["assemblyRuns"]["start"]
      >[0],
    ) => pipeline().assemblyRuns.start(input),
  };
}
