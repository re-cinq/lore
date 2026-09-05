// Cross-cutting helpers every agent-watcher module needs: the shared AgentContext, Slack/issue notification, and per-task token cleanup.
import { HttpTokenCleanup } from "@re-cinq/lore-shared";
import { projectFor } from "../../kernel/project-boot.js";
import { taskStore, clusterAgent } from "../../kernel/queues.js";
import type { NotifyLevel } from "@re-cinq/lore-shared/project/notify/notify-port.js";

/** Context threaded through the per-outcome handlers, recovered entirely from the run/task rows + event — never read back from the cluster. */
export interface AgentContext {
  taskId: string;
  taskType: string;
  branch: string;
  targetRepo: string;
  description: string;
  output: string;
}

/** Agent output can be large — keep only the tail for issue/PR bodies. */
export function tailOutput(output: string, limit = 60000): string {
  return output.length > limit
    ? output.slice(-limit) + "\n\n…(truncated)"
    : output;
}

/** Best-effort per-task token + AgentDefinition/Station cleanup (#697); exported so a station line reclaims its shared token only once the whole line is done. */
export function cleanupPerTaskToken(taskId: string): Promise<void> {
  return new HttpTokenCleanup(clusterAgent()).cleanup(taskId).catch((err) =>
    // Swallowed so a task still settles on reclaim failure, but logged (used to hide a 403).
    console.warn(
      `[agent-watcher] token cleanup for ${taskId} failed:`,
      (err as Error).message,
    ),
  );
}

// ── Telling the repo about one task update ──────────

/** One CR produces at most one of these — the three call sites are mutually exclusive per phase. */
type SlackUpdateType = "pr" | "completed" | "failed";

/** Prefix + notify level in one table so they can't drift; the level is what `dark_factory.notify` filters on. */
const SLACK_UPDATES: Record<
  SlackUpdateType,
  { prefix: string; level: NotifyLevel }
> = {
  pr: { prefix: "PR ready for review", level: "pr_open" },
  completed: { prefix: "Task completed", level: "completion" },
  failed: { prefix: "Task failed", level: "escalation" },
};

/** Routes through `project.notify` (has the `decideNotify` gate a prior duplicate Slack poster lacked); prefers the task's originating Slack channel. */
async function notifySlack(
  taskId: string,
  repo: string,
  level: NotifyLevel,
  message: string,
): Promise<void> {
  const bundle = (await taskStore().getById(taskId))?.context_bundle as
    { slack_channel_id?: string } | undefined;
  const project = await projectFor(repo);

  await project.notify.notify(level, message, {
    channel: bundle?.slack_channel_id,
  });
}

export async function notifyTaskUpdate(
  taskId: string,
  repo: string,
  type: SlackUpdateType,
  message: string,
): Promise<void> {
  const { prefix, level } = SLACK_UPDATES[type];

  await notifySlack(taskId, repo, level, `${prefix}: ${message}`).catch(
    () => {},
  );
}

// ── Helpers (CR-agnostic) ─────────────────

export async function getIssueNumber(
  taskId: string,
): Promise<{ issue_number: number | null; target_repo: string }> {
  const task = await taskStore().getById(taskId);

  if (!task) {
    return { issue_number: null, target_repo: "" };
  }

  return {
    issue_number: task.issue_number ?? null,
    target_repo: task.target_repo,
  };
}

export async function linkPrToIssue(
  repo: string,
  issueNumber: number | null,
  prUrl: string,
): Promise<void> {
  if (!issueNumber) {
    return;
  }

  try {
    const project = await projectFor(repo);

    await project.issues.comment(issueNumber, `PR created: ${prUrl}`);
    await project.issues.close(issueNumber, "completed");
  } catch {
    /* best effort */
  }
}

export async function commentFailureOnIssue(
  repo: string,
  issueNumber: number | null,
  reason: string,
): Promise<void> {
  if (!issueNumber) {
    return;
  }

  try {
    const project = await projectFor(repo);

    await project.issues.comment(issueNumber, `Task failed: \`${reason}\``);
    await project.issues.addLabel(issueNumber, "lore-failed");
  } catch {
    /* best effort */
  }
}
