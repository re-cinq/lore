/**
 * Terminal Agent-run processing (ADR-031). The decisions that differ from a
 * LoreTask (the reported status carries no changedFiles / reviewResult / taskType,
 * and the deterministic gate is the repo's GitHub Actions conclusion, D3) live in
 * agent-watcher-logic.ts; this is the IO shell.
 *
 * `processAgentTerminal` is a thin dispatcher: it recovers the dispatch facts,
 * applies the DB re-entry guard, and routes a terminal run to one of the extracted
 * handlers (`handleSucceededChanges` → no-changes / PR, `handleFailure`,
 * `handleReviewVerdict`).
 *
 * Event-driven (the event bus): a cluster-agent's watch reports the terminal phase
 * inward, the router writes `kubernetes.agent.{succeeded,failed}`, and the handler
 * settles the run from THAT — it does not read the cluster back. It cannot: since
 * dispatch went pull-based, the pod may have run in a cluster this process has no
 * route to, and a CR read there answers "gone" indistinguishably from "never
 * existed". The reconcile path (agent-reconcile) still lists and prunes CRs, but
 * only in the cluster it can reach, and only as a re-emit backstop.
 */

import { resultTextFromOutput } from "@re-cinq/lore-assembly-lines";
import { startEscalationLine } from "@re-cinq/lore-shared/escalation/start-escalation-line.js";
import {
  projectFor,
  assemblyLineNames,
} from "../../composition/project-boot.js";
import { memoryLifecycle, pipeline, taskStore } from "../../kernel/queues.js";
import { writeEpisode, writeEpisodeWithCuration } from "@re-cinq/lore-shared";
import { tryAutoMergeForCompletedTask } from "../merge/auto-merge-trigger.js";
import {
  isTransientInfraFailure,
  MAX_INFRA_RETRIES,
} from "@re-cinq/lore-shared/k8s-pod-failure.js";
import {
  buildReviewFixDescription,
  formatReviewFeedback,
  prFooter,
  linkifyMarkdown,
} from "@re-cinq/lore-shared";
import { generateArtifactCopy } from "../lib/artifact-copy.js";
import { shouldAutoReview } from "../review/should-auto-review.js";
import {
  parseReviewResult,
  decideCiGate,
  decideTokenReclaim,
  runOutcomeFromTaskStatus,
  type ReviewResult,
  decideFeatureLink,
  taskPageUrl,
  stampPrOnOpenRuns,
  dispatchFacts,
  stationOutcomeForRunOutcome,
  type AgentTerminalReport,
} from "./agent-watcher-logic.js";
import { errorMessage, HttpTokenProvisioner } from "@re-cinq/lore-shared";
import { clusterAgent } from "../../kernel/queues.js";
import type { NotifyLevel } from "@re-cinq/lore-shared/project/notify/notify-port.js";

/** Agent output can be large — keep only the tail for issue/PR bodies. */
function tailOutput(output: string, limit = 60000): string {
  return output.length > limit
    ? output.slice(-limit) + "\n\n…(truncated)"
    : output;
}

/** Best-effort removal of a terminal task's per-task token key + AgentDefinition/Station
 *  triple (#697). Idempotent (404s ignored); co-located with Agent-CR deletion. Exported
 *  so the assembly-line completion path reclaims a station line's token (its shared token
 *  can only be freed once the whole line is done — no per-node cleanup is safe). */
export function cleanupPerTaskToken(taskId: string): Promise<void> {
  return new HttpTokenProvisioner(clusterAgent()).cleanup(taskId).catch((err) =>
    // Swallowed as before — a task must settle even if reclaim fails — but
    // LOGGED now. This used to hide a 403 the Floor's RBAC never granted, and
    // an unreachable agent would look exactly the same.
    console.warn(
      `[agent-watcher] token cleanup for ${taskId} failed:`,
      (err as Error).message,
    ),
  );
}

// ── Telling the repo about one task update ──────────

/**
 * One CR produces AT MOST ONE of these: the three call sites below are mutually
 * exclusive per phase (a Succeeded CR reports either no-changes or a PR; a
 * Failed one reports a failure; a review verdict reports nothing here).
 *
 * There used to be a `SlackBatch` collected per invocation and
 * flushed at the end. Because it was per-invocation it never held more than one
 * entry, so its `byRepo` grouping and its whole `N PRs ready / N tasks completed
 * / N failed` summary branch — about sixty lines — could not be reached by any
 * call, and no test could cover them.
 */
type SlackUpdateType = "pr" | "completed" | "failed";

/**
 * How each update reads and how urgent it is, in ONE table — the prefix and the
 * notify level answer the same question about the same value, and splitting them
 * across two switches is how they drift.
 *
 * The level matters: it is what the repo's `dark_factory.notify` channel list
 * filters on, so a repo that wants escalations only still hears about failures.
 */
const SLACK_UPDATES: Record<
  SlackUpdateType,
  { prefix: string; level: NotifyLevel }
> = {
  pr: { prefix: "PR ready for review", level: "pr_open" },
  completed: { prefix: "Task completed", level: "completion" },
  failed: { prefix: "Task failed", level: "escalation" },
};

async function notifyTaskUpdate(
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

/**
 * Tell the repo's people about a task, through `project.notify`.
 *
 * This used to be a second Slack poster — its own token lookup, its own channel
 * lookup, its own fetch — sitting beside the shared one and differing in the way
 * that matters: it had no `decideNotify` gate, so a repo that had switched Slack
 * off in `dark_factory.notify` still got every PR and failure message from the
 * watcher. The one thing it did that the port could not was prefer the channel a
 * Slack-ORIGINATED task came from, so that became an option on the port rather
 * than a reason to keep a second implementation.
 */
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

async function getIssueNumber(
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
async function linkPrToIssue(
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
async function commentFailureOnIssue(
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

/** The derived context threaded through the per-outcome handlers.
 *
 *  Holds no cluster handle and no CR name. Everything here was recovered from
 *  what the Floor wrote down (the run row, the task row) plus what the event
 *  reported — nothing is read back from the cluster that ran the pod, because
 *  that cluster is not necessarily one this process can reach. */
interface AgentContext {
  taskId: string;
  taskType: string;
  branch: string;
  targetRepo: string;
  description: string;
  output: string;
}

/** Close a single-CR task's open run rows with an outcome derived from the task's
 *  post-handler status (total coverage — no walk finishes these rows). The CR
 *  `phase` disambiguates an un-advanced task: a Failed CR whose task is still
 *  `running` (e.g. Failed with no failureReason) closes its row `failed`, not
 *  `completed`. */
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
      // The visit before the run. A single CR's node row is now a real queued
      // visit a cluster claimed, so leaving it open would leave the run's one
      // station showing as still executing after the run itself had closed —
      // and would keep the reaper interested in a row nobody is working.
      const nodes = await pipeline().assemblyRuns.listStationRuns(row.id);

      await Promise.all(
        nodes
          .filter((node) => node.outcome === null)
          .map((node) =>
            pipeline().assemblyRuns.finishStationRunOnce(
              node.id,
              stationOutcomeForRunOutcome(outcome),
              undefined,
              // `unknown`, not an invented class: failureClass is the closed
              // taxonomy of INFRASTRUCTURE failures that drive retry and the
              // account-wide dispatch gate. What this run reported belongs in
              // the detail, which is the part a reader needs.
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

/**
 * Settle one terminal Agent run from the report its event carried. Invoked by the
 * `kubernetes.agent.{succeeded,failed}` handlers. Recovers the dispatch facts,
 * applies the DB re-entry guard, and dispatches to the matching handler; the
 * Slack flush runs in `finally` so an early return still delivers notifications.
 *
 * Nothing here touches a cluster. Assembly-line NODE CRs never arrive: the event
 * mapper routes them to `kubernetes.agent_node.*` on their assembly-run label, so
 * the label check this function used to make was unreachable by the time the
 * params were built.
 */
export async function processAgentTerminal(
  report: AgentTerminalReport,
): Promise<void> {
  const { taskId, phase } = report;

  // DB-level re-entry guard (only act on tasks still running/queued). A run whose
  // taskId has no backing pipeline task is a task-less assembly line (e.g.
  // code-review, keyed on its assemblyLineId): the supervisor owns the run, so the
  // watcher has nothing to reconcile — return before any PR/no-changes work.
  const task = await taskStore().getById(taskId);

  if (!task || !["running", "queued"].includes(task.status)) {
    return;
  }
  // The run row first: it recorded the repo, branch and description AT dispatch,
  // and unlike the Agent CR it is neither cluster-local nor pruned an hour later.
  const runs = await pipeline().assemblyRuns.listForTask(taskId);
  const run =
    runs.find((row) => ["queued", "running"].includes(row.status)) ??
    runs[runs.length - 1];
  const facts = dispatchFacts(run ?? null, task);

  if (!facts) {
    return;
  }
  const ctx: AgentContext = {
    taskId,
    ...facts,
    output: resultTextFromOutput(report.output ?? ""),
  };

  // No `status.prUrl` guard: it was the CR's own re-entry marker, and every path
  // that stamped it had already moved the task out of `running` first — so the
  // DB guard above is the same gate, read from the source that survives the pod.
  if (phase === "Succeeded" && ctx.taskType !== "review") {
    await handleSucceededChanges(ctx);
  }

  if (phase === "Failed" && report.failureReason) {
    await handleFailure(ctx, report.failureReason);
  }

  // Review verdict (parsed from the reported output — Agent has no reviewResult field).
  const reviewResult =
    phase === "Succeeded" && ctx.taskType === "review"
      ? parseReviewResult(ctx.output)
      : undefined;

  if (reviewResult) {
    await handleReviewVerdict(ctx, reviewResult);
  }

  // Terminal single-CR task: close its run row (the watcher owns the single-CR
  // lifecycle — no walk finishes these) and reclaim the per-task token (#784).
  // Multi-node station lines do both at line completion, so the tell is the
  // routing (builtin assembly line for the task type), not row existence.
  const isAssemblyLineTask = (await assemblyLineNames()).has(ctx.taskType);

  if (!isAssemblyLineTask) {
    await finishSingleCrRunRows(taskId, phase, report.failureReason);
  }

  if (decideTokenReclaim({ phase, isAssemblyLineTask })) {
    await cleanupPerTaskToken(taskId);
  }
}

/** Succeeded, non-review, no PR yet: compute the changed-file count and either close
 *  out a no-changes task (issue) or open a PR (+ CI gate, auto-review fan-out). */
async function handleSucceededChanges(ctx: AgentContext): Promise<void> {
  const { taskId, taskType, branch, targetRepo, description, output } = ctx;
  const taskUrl = taskPageUrl(taskId, process.env.LORE_UI_URL);
  const logsRef = taskUrl ? `See [logs](${taskUrl})` : "See logs";

  // Agent.status has no changedFiles — compute it via compare-commits.
  let changedFiles = 0;

  try {
    const proj = await projectFor(targetRepo);
    const base = await proj.repo.defaultBranch();

    changedFiles = await proj.pulls.changedFileCount(base, branch);
  } catch (err) {
    console.warn(
      `[agent-watcher] changed-file count failed for ${taskId}: ${errorMessage(err)}`,
    );
  }

  if (changedFiles === 0) {
    // feature-planning posts its result straight to the features API (ADR-027).
    if (taskType === "feature-planning") {
      try {
        await taskStore().setStatus(taskId, "completed");
        await taskStore().recordEvent(taskId, "running", "completed", {
          feature_planning: true,
        });
      } catch (err) {
        console.error(
          `[agent-watcher] feature-planning completion failed for ${taskId}: ${errorMessage(err)}`,
        );
      }

      return;
    }

    try {
      let { issue_number, target_repo } = await getIssueNumber(taskId);

      if (!target_repo) {
        target_repo = targetRepo;
      }

      if (!issue_number) {
        try {
          const copy = await generateArtifactCopy({
            kind: "issue",
            taskType,
            description,
            agentOutput: output,
            repo: target_repo,
          });
          const body = output
            ? `${tailOutput(output)}\n\n---\n*Lore-Task: ${taskId}*`
            : `${copy.body}\n\nTask completed (no output). ${logsRef}.`;
          const issue = await (
            await projectFor(target_repo)
          ).issues.create(copy.title, body, ["lore-managed", taskType]);

          issue_number = issue.number;
          await pipeline().taskQueue.setColumns(taskId, {
            issue_number: issue.number,
            issue_url: issue.url,
          });
        } catch {
          /* best effort */
        }
      } else {
        const body = output
          ? `## Result\n\n${tailOutput(output)}`
          : `Task completed (no code changes). ${logsRef} for full output.`;

        await projectFor(target_repo)
          .then((p) => p.issues.comment(issue_number!, body))
          .catch(() => {});
      }
      await taskStore().setStatus(taskId, "completed", { log_url: taskUrl });
      await taskStore().recordEvent(taskId, "running", "completed", {
        no_changes: true,
        issue_number,
      });

      if (issue_number) {
        await notifyTaskUpdate(
          taskId,
          target_repo,
          "completed",
          `https://github.com/${target_repo}/issues/${issue_number}`,
        );
      }
      writeEpisode(
        { memory: memoryLifecycle() },
        `Task ${taskType} on ${target_repo} completed (no changes)\nDescription: ${description.substring(0, 500)}\nOutput: ${output.substring(0, 2000)}`,
        "ci",
        `${target_repo}/${taskId}`,
      ).catch(() => {});
      console.log(
        `[agent-watcher] Task ${taskId} completed → issue #${issue_number || "none"}`,
      );
    } catch (err) {
      console.error(
        `[agent-watcher] Failed to complete no-change task ${taskId}: ${errorMessage(err)}`,
      );
    }

    return;
  }

  // Open a PR from the pushed branch.
  try {
    const { issue_number, target_repo } = await getIssueNumber(taskId);
    const footer = prFooter({ issueNumber: issue_number, taskId });
    const copy = await generateArtifactCopy({
      kind: "pr",
      taskType,
      description,
      agentOutput: output,
      changedFiles,
      repo: targetRepo,
    });
    const body = linkifyMarkdown(copy.body, {
      repo: targetRepo,
      branch,
      uiUrl: process.env.LORE_UI_URL,
    });
    const prProject = await projectFor(targetRepo);
    const pr = await prProject.pulls.open(
      branch,
      copy.title,
      `${body}${footer}`,
    );

    await taskStore().setStatus(taskId, "pr-created", {
      pr_url: pr.url,
      pr_number: pr.number,
      target_branch: branch,
      log_url: taskUrl,
    });
    // Best-effort AND outside the failure path: the PR is already open, so a
    // stamp failure must not re-label this as a PR-open failure. A missing
    // stamp leaves await-pr's route unresolved and pr-ready-check skipping the
    // run with a log line — visible, recoverable, not fatal.
    await stampPrOnOpenRuns(pipeline().assemblyRuns, taskId, pr).catch((err) =>
      console.warn(
        `[agent-watcher] stampPrOnOpenRuns failed for ${taskId} — await-pr route may be unresolvable: ${errorMessage(err)}`,
      ),
    );
    await taskStore().recordEvent(taskId, "running", "pr-created", {
      pr_url: pr.url,
    });
    await linkPrToIssue(target_repo, issue_number, pr.url);

    // Link the spec PR back to the feature row (ADR-027). Keyed on the task carrying
    // a feature, not on its type: the merged line runs a feature's whole life under
    // one feature-planning task (FR6.26).
    try {
      const link = decideFeatureLink(
        taskType,
        (await taskStore().getById(taskId))?.context_bundle as
          { feature_id?: string; slug?: string } | undefined,
      );

      if (link) {
        await prProject.features.transitionStatus(link.featureId, "pr-open", {
          spec_pr_url: pr.url,
          spec_pr_number: pr.number,
          ...(link.slug ? { spec_path: `specs/${link.slug}/spec.md` } : {}),
        });
      }
    } catch (err) {
      console.warn(
        `[agent-watcher] feature link failed for ${taskId}: ${errorMessage(err)}`,
      );
    }

    console.log(`[agent-watcher] Task ${taskId} → PR ${pr.url}`);
    await notifyTaskUpdate(taskId, targetRepo, "pr", pr.url);
    writeEpisodeWithCuration(
      { memory: memoryLifecycle() },
      `Task ${taskType} on ${targetRepo}: created PR ${pr.url}\nChanged files: ${changedFiles}\nDescription: ${description.substring(0, 500)}`,
      "ci",
      `${targetRepo}/${taskId}`,
      "agent-watcher",
      taskId,
    ).catch(() => {});

    // Deterministic CI gate (D3): only fire auto-merge once CI is green; a red or
    // still-running CI defers (the webhook-driven re-trigger re-fires when CI
    // completes). tryAutoMergeForCompletedTask also re-checks CI itself, so this
    // is belt-and-suspenders that keeps the watcher's gate explicit.
    let gate: "proceed" | "defer" = "proceed";

    try {
      gate = decideCiGate(await prProject.pulls.ciConclusion(branch));
    } catch {
      /* treat probe failure as proceed; auto-merge re-checks */
    }

    if (gate === "proceed") {
      tryAutoMergeForCompletedTask({ taskId }).catch((err) =>
        console.warn(
          `[agent-watcher] auto-merge trigger failed for task ${taskId}:`,
          (err as Error).message,
        ),
      );
    } else {
      console.log(
        `[agent-watcher] CI not green for ${taskId} — deferring auto-merge to the webhook re-trigger`,
      );
    }

    if (await shouldAutoReview(targetRepo)) {
      const reviewTaskId = (await pipeline().taskQueue.insertTask({
        description: `Review PR #${pr.number} on ${targetRepo}`,
        taskType: "review",
        targetRepo,
        createdBy: "agent-watcher",
        contextBundle: { pr_number: pr.number, branch, parent_task_id: taskId },
      })) as string;

      await (
        await projectFor(targetRepo)
      ).agents.run(reviewTaskId, {
        mode: "cluster",
        taskType: "review",
        description: `Review PR #${pr.number} on ${targetRepo}`,
        prompt: `Review PR #${pr.number} on this branch. Read the spec in specs/ for the feature requirements. Check all changes against CLAUDE.md conventions and ADRs in adrs/. Post specific review comments on the PR using 'gh pr review'. Then output exactly one of:\n- REVIEW_RESULT:APPROVED\n- REVIEW_RESULT:CHANGES_REQUESTED:<specific actionable feedback>`,
        branch,
        prNumber: pr.number,
        model: "claude-sonnet-4-6",
        timeoutMinutes: 10,
      });
      await taskStore().setStatus(taskId, "review");
      await taskStore().recordEvent(taskId, "pr-created", "review", {
        review_task_id: reviewTaskId,
        auto_review: true,
      });
      console.log(
        `[agent-watcher] Auto-review: created review task ${reviewTaskId} for PR #${pr.number}`,
      );
    }
  } catch (err) {
    const msg = String(errorMessage(err) || err);

    console.error(`[agent-watcher] Failed to create PR for ${taskId}: ${msg}`);
    const isNoCommits = /No commits between/i.test(msg);
    const isPrExists = /A pull request already exists/i.test(msg);

    if (isNoCommits || isPrExists) {
      const reason = isNoCommits ? "no-code-changes" : "pr-already-exists";

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

      // Tell a human. The status above is a row nobody reads unprompted; the
      // escalation line is the channel ADR-016 designed for dark mode, and it
      // had no caller at all between #805 and now. Swallowed, because failing to
      // ESCALATE a failure must not itself become the failure.
      await startEscalationLine(
        { id: taskId, repo: targetRepo, branch },
        {
          // The reason computed twelve lines up, not a generic panic: the Issue
          // title carries this to a human, and "the supervisor panicked" sends
          // them hunting a crash when the agent simply produced no commits.
          reason: isNoCommits ? "no_code_changes" : "pr_already_exists",
          diagnostic: `createPR failed: ${reason}. ${msg.substring(0, 500)}`,
        },
        {
          findOpenBySubject: (repo: string, key: string) =>
            pipeline().assemblyRuns.findOpenBySubject(repo, key),
          countBySubject: (repo: string, key: string) =>
            pipeline().assemblyRuns.countBySubject(repo, key),
          start: (input) => pipeline().assemblyRuns.start(input),
        },
      ).catch((err) =>
        console.error(
          `[agent-watcher] escalation for ${taskId} not started:`,
          (err as Error).message,
        ),
      );

      await cleanupPerTaskToken(taskId);
      console.log(
        `[agent-watcher] Marked ${taskId} needs-human-help (${reason})`,
      );
    }
  }
}

/** Failed CR: record the failure, with a bounded transient-infra re-queue. */
async function handleFailure(ctx: AgentContext, reason: string): Promise<void> {
  const { taskId, taskType, targetRepo, description, output } = ctx;
  const failedTask = await taskStore().getById(taskId);
  const bundle = failedTask?.context_bundle ?? {};
  const infraRetries = Number(bundle.infra_retry_count ?? 0);
  const taskUrl = taskPageUrl(taskId, process.env.LORE_UI_URL);

  if (
    failedTask?.status === "running" &&
    isTransientInfraFailure(reason) &&
    infraRetries < MAX_INFRA_RETRIES
  ) {
    await taskStore().setStatus(taskId, "failed", {
      failure_reason: reason,
      log_url: taskUrl,
    });
    await taskStore().recordEvent(taskId, "running", "failed", {
      error: reason,
      transient_infra: true,
      infra_retry: infraRetries + 1,
    });
    const requeuedId = await pipeline().taskQueue.insertTask({
      description,
      taskType,
      status: "pending",
      targetRepo,
      createdBy: failedTask.created_by,
      contextBundle: {
        ...bundle,
        infra_retry_count: infraRetries + 1,
        retry_of: taskId,
      },
    });

    if (requeuedId && failedTask.issue_number != null) {
      await pipeline().taskQueue.setColumns(requeuedId, {
        issue_number: failedTask.issue_number,
      });
    }
    console.log(
      `[agent-watcher] Task ${taskId} transient infra failure (${reason}) — re-queued ${infraRetries + 1}/${MAX_INFRA_RETRIES}`,
    );
  } else if (failedTask?.status === "running") {
    await taskStore().setStatus(taskId, "failed", {
      failure_reason: reason,
      log_url: taskUrl,
    });
    await taskStore().recordEvent(taskId, "running", "failed", {
      error: reason,
    });
    await commentFailureOnIssue(
      failedTask.target_repo,
      failedTask.issue_number ?? null,
      reason,
    );
    await notifyTaskUpdate(
      taskId,
      failedTask.target_repo,
      "failed",
      `${taskType}: ${reason.substring(0, 200)}`,
    );
    writeEpisodeWithCuration(
      { memory: memoryLifecycle() },
      `Task failed on ${targetRepo}: ${taskType}\n\nDescription: ${description}\n\nFailure: ${reason}\n\nOutput:\n${output.slice(-2000)}`,
      "ci",
      `${targetRepo}/${taskId}`,
      "agent-watcher",
      taskId,
    ).catch(() => {});
    console.log(`[agent-watcher] Task ${taskId} failed: ${reason}`);
  }
}

/** A review Agent's verdict drives the iteration-capped fix loop on the parent task. */
async function handleReviewVerdict(
  ctx: AgentContext,
  reviewResult: ReviewResult,
): Promise<void> {
  const { taskId, branch } = ctx;
  const reviewTask = await taskStore().getById(taskId);

  if (reviewTask && reviewTask.status !== "running") {
    return;
  }
  const contextBundle = reviewTask?.context_bundle as
    { parent_task_id?: string } | undefined;
  const parentTaskId: string | undefined = contextBundle?.parent_task_id;

  if (!parentTaskId) {
    console.log(
      `[agent-watcher] Review ${taskId} has no parent task, skipping`,
    );

    return;
  }

  if (reviewResult === "approved") {
    await taskStore().setStatus(parentTaskId, "completed");
    await taskStore().recordEvent(parentTaskId, "review", "completed", {
      review_result: "approved",
      review_task_id: taskId,
    });
    const { issue_number, target_repo } = await getIssueNumber(parentTaskId);

    if (issue_number) {
      await projectFor(target_repo)
        .then((p) =>
          p.issues.comment(
            issue_number,
            "Agent review: **approved**. PR is ready for human merge.",
          ),
        )
        .catch(() => {});
    }
    await taskStore().setStatus(taskId, "completed");
    console.log(
      `[agent-watcher] Review approved for parent task ${parentTaskId}`,
    );
  } else {
    const parent = await taskStore().getById(parentTaskId);

    if (!parent) {
      return;
    }
    const iteration = (Number(parent.review_iteration) || 0) + 1;

    await pipeline().taskQueue.setColumns(parentTaskId, {
      review_iteration: iteration,
    });

    if (iteration >= 2) {
      await taskStore().recordEvent(parentTaskId, "review", "review", {
        review_result: "needs-human-review",
        iterations: iteration,
      });

      if (parent.issue_number) {
        await projectFor(parent.target_repo)
          .then((p) =>
            p.issues.comment(
              parent.issue_number!,
              `Agent review: changes requested (iteration ${iteration}/2). Escalating to human review.`,
            ),
          )
          .catch(() => {});
        await projectFor(parent.target_repo)
          .then((p) =>
            p.issues.addLabel(parent.issue_number!, "needs-human-review"),
          )
          .catch(() => {});
      }
      await taskStore().setStatus(taskId, "completed");
      console.log(
        `[agent-watcher] Review escalated to human for ${parentTaskId} (iteration ${iteration})`,
      );
    } else {
      const comments = parent.pr_number
        ? await projectFor(parent.target_repo)
            .then((p) => p.pulls.listComments(parent.pr_number!))
            .catch(() => [])
        : [];
      const feedback =
        formatReviewFeedback(comments) ||
        "The agent review requested changes. Read the review comments on the PR and address them.";
      const fixDescription = buildReviewFixDescription({
        prNumber: parent.pr_number ?? null,
        iteration,
      });
      const fixTaskId = (await pipeline().taskQueue.insertTask({
        description: fixDescription,
        taskType: "implementation",
        targetRepo: parent.target_repo,
        createdBy: "review-loop",
        contextBundle: {
          branch: parent.target_branch,
          review_feedback: feedback,
          parent_task_id: parentTaskId,
        },
      })) as string;

      await (
        await projectFor(parent.target_repo)
      ).agents.run(fixTaskId, {
        mode: "cluster",
        taskType: "implementation",
        description: fixDescription,
        prompt: `Address the following review feedback on PR #${parent.pr_number ?? "?"}. The PR already exists — push fixes to the same branch.\n\nFeedback:\n${feedback}`,
        branch: parent.target_branch || branch,
        model: "claude-sonnet-4-6",
        timeoutMinutes: 30,
      });

      if (parent.issue_number) {
        await projectFor(parent.target_repo)
          .then((p) =>
            p.issues.comment(
              parent.issue_number!,
              `Agent review: changes requested (iteration ${iteration}/2). Auto-fixing...`,
            ),
          )
          .catch(() => {});
      }
      await taskStore().setStatus(taskId, "completed");
      console.log(
        `[agent-watcher] Review changes requested, created fix task ${fixTaskId} (iteration ${iteration})`,
      );
    }
  }
}
