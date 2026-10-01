// What happens when the PR CANNOT be opened. Separate from agent-watcher-pr-delivery.ts, which is the success path: the two share a trigger, not a job, and only this half reaches a human.

import { cleanupPerTaskToken } from "./per-task-token.js";
import { errorMessage } from "@re-cinq/lore-shared";
import { taskStore } from "../../outbound/queues.js";
import type { AgentContext } from "./agent-watcher-notify.js";

/** No commits / a pre-existing PR are the two createPR failures a human, not a retry, resolves: the task is parked `needs-human-help` with the reason, which is what its page and the task list show. Any other failure is left for the next event. The escalation line that also filed an Issue is gone (#2330): it never ran once in production. */

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

  await cleanupPerTaskToken(taskId);
  console.log(`[agent-watcher] Marked ${taskId} needs-human-help (${reason})`);
}

/** Both writes are `.catch`-swallowed: a failed write must not stop the token cleanup that follows. */
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
