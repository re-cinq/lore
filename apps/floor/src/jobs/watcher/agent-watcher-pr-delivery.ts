// Turning a succeeded run with code changes into an open PR: changed-file count, PR body, cross-links, the auto-merge CI gate, and opt-in auto-review.
import { cleanupPerTaskToken } from "../lib/per-task-token.js";
import { startEscalationLine } from "@re-cinq/lore-shared/escalation/start-escalation-line.js";
import { projectFor } from "../../kernel/project-boot.js";
import { memoryLifecycle, pipeline, taskStore } from "../../kernel/queues.js";
import { writeEpisodeWithCuration, errorMessage } from "@re-cinq/lore-shared";
import { tryAutoMergeForCompletedTask } from "../merge/auto-merge-trigger.js";
import { prFooter, linkifyMarkdown } from "@re-cinq/lore-shared";
import { generateArtifactCopy } from "../lib/artifact-copy.js";
import { shouldAutoReview } from "../lib/should-auto-review.js";
import {
  decideCiGate,
  decideFeatureLink,
  taskPageUrl,
  stampPrOnOpenRuns,
} from "../lib/agent-watcher-logic.js";
import {
  type AgentContext,
  getIssueNumber,
  linkPrToIssue,
  notifyTaskUpdate,
} from "./agent-watcher-notify.js";
import { completeNoChangeTask } from "./agent-watcher-no-change.js";

/** Agent.status has no changedFiles — compute it via compare-commits. */
async function computeChangedFileCount(ctx: AgentContext): Promise<number> {
  try {
    const proj = await projectFor(ctx.targetRepo);
    const base = await proj.repo.defaultBranch();

    return await proj.pulls.changedFileCount(base, ctx.branch);
  } catch (err) {
    console.warn(
      `[agent-watcher] changed-file count failed for ${ctx.taskId}: ${errorMessage(err)}`,
    );

    return 0;
  }
}

/** Opens the PR, stamps status onto it and the open run rows — no decisions, just the writes a successful open needs. */
async function openPrAndRecord(
  ctx: AgentContext,
  changedFiles: number,
): Promise<{
  pr: Awaited<
    ReturnType<Awaited<ReturnType<typeof projectFor>>["pulls"]["open"]>
  >;
  targetRepo: string;
  issueNumber: number | null;
  prProject: Awaited<ReturnType<typeof projectFor>>;
}> {
  const { taskId, taskType, branch, targetRepo, description, output } = ctx;
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
  const pr = await prProject.pulls.open(branch, {
    title: copy.title,
    body: `${body}${footer}`,
  });

  await taskStore().setStatus(taskId, "pr-created", {
    pr_url: pr.url,
    pr_number: pr.number,
    target_branch: branch,
    log_url: taskPageUrl(taskId, process.env.LORE_UI_URL),
  });
  // Best-effort outside the failure path: PR is already open, a stamp failure must not re-label it as PR-open failure.
  await stampPrOnOpenRuns(pipeline().assemblyRuns, taskId, pr).catch((err) =>
    console.warn(
      `[agent-watcher] stampPrOnOpenRuns failed for ${taskId} — await-pr route may be unresolvable: ${errorMessage(err)}`,
    ),
  );
  await taskStore().recordEvent(taskId, "running", "pr-created", {
    pr_url: pr.url,
  });

  return { pr, targetRepo: target_repo, issueNumber: issue_number, prProject };
}

interface OpenedPr {
  pr: Awaited<
    ReturnType<Awaited<ReturnType<typeof projectFor>>["pulls"]["open"]>
  >;
  targetRepo: string;
  issueNumber: number | null;
  changedFiles: number;
  prProject: Awaited<ReturnType<typeof projectFor>>;
}

/** Issue cross-link, feature-row link, and the completion episode/notification — every write a freshly opened PR needs told about it. */
async function linkPrArtifacts(
  ctx: AgentContext,
  opened: OpenedPr,
): Promise<void> {
  const { taskId, taskType, description } = ctx;
  const { pr, targetRepo, issueNumber, changedFiles, prProject } = opened;

  await linkPrToIssue(targetRepo, issueNumber, pr.url);

  // Link the spec PR back to the feature row (ADR-027) — keyed on the task carrying a feature, not its type (FR6.26).
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
    {
      content: `Task ${taskType} on ${targetRepo}: created PR ${pr.url}\nChanged files: ${changedFiles}\nDescription: ${description.substring(0, 500)}`,
      source: "ci",
      ref: `${targetRepo}/${taskId}`,
      agentId: "agent-watcher",
      taskId,
    },
  ).catch(() => {});
}

/** Deterministic CI gate (D3): fire auto-merge only once CI is green; a red/running CI defers to the webhook re-trigger. */
async function runAutoMergeGate(
  ctx: AgentContext,
  prProject: Awaited<ReturnType<typeof projectFor>>,
): Promise<void> {
  const { taskId, branch } = ctx;
  let gate: "proceed" | "defer" = "proceed";

  try {
    gate = decideCiGate(await prProject.pulls.ciConclusion(branch));
  } catch {
    /* treat probe failure as proceed; auto-merge re-checks */
  }

  if (gate !== "proceed") {
    console.log(
      `[agent-watcher] CI not green for ${taskId} — deferring auto-merge to the webhook re-trigger`,
    );

    return;
  }
  tryAutoMergeForCompletedTask({ taskId }).catch((err) =>
    console.warn(
      `[agent-watcher] auto-merge trigger failed for task ${taskId}:`,
      (err as Error).message,
    ),
  );
}

/** Opt-in auto-review (per-repo setting): dispatches a review Agent against the just-opened PR. */
async function maybeStartAutoReview(
  ctx: AgentContext,
  pr: OpenedPr["pr"],
): Promise<void> {
  const { taskId, targetRepo, branch } = ctx;

  if (!(await shouldAutoReview(targetRepo))) {
    return;
  }
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

/** Open a PR from the pushed branch and tell everything downstream about it — issue, feature row, CI gate, auto-review. */
async function deliverPrForTask(
  ctx: AgentContext,
  changedFiles: number,
): Promise<void> {
  const { pr, targetRepo, issueNumber, prProject } = await openPrAndRecord(
    ctx,
    changedFiles,
  );

  await linkPrArtifacts(ctx, {
    pr,
    targetRepo,
    issueNumber,
    changedFiles,
    prProject,
  });
  await runAutoMergeGate(ctx, prProject);
  await maybeStartAutoReview(ctx, pr);
}

/** No commits / a pre-existing PR are the two createPR failures a human, not a retry, resolves — escalate via the ADR-016 line (had no caller between #805 and now); any other failure is left for the next event. */
async function handlePrCreationFailure(
  ctx: AgentContext,
  err: unknown,
): Promise<void> {
  const { taskId, targetRepo, branch } = ctx;
  const msg = String(errorMessage(err) || err);

  console.error(`[agent-watcher] Failed to create PR for ${taskId}: ${msg}`);
  const isNoCommits = /No commits between/i.test(msg);
  const isPrExists = /A pull request already exists/i.test(msg);

  if (!(isNoCommits || isPrExists)) {
    return;
  }
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

  await startEscalationLine(
    { id: taskId, repo: targetRepo, branch },
    {
      // Specific reason, not a generic panic, so the Issue title doesn't send a human hunting a crash.
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
  console.log(`[agent-watcher] Marked ${taskId} needs-human-help (${reason})`);
}

/** Succeeded non-review: compute changed-file count, close no-changes task or open PR. */
export async function handleSucceededChanges(ctx: AgentContext): Promise<void> {
  const changedFiles = await computeChangedFileCount(ctx);

  if (changedFiles !== 0) {
    try {
      await deliverPrForTask(ctx, changedFiles);
    } catch (err) {
      await handlePrCreationFailure(ctx, err);
    }

    return;
  }
  const taskUrl = taskPageUrl(ctx.taskId, process.env.LORE_UI_URL);
  const logsRef = taskUrl ? `See [logs](${taskUrl})` : "See logs";

  await completeNoChangeTask(ctx, taskUrl, logsRef);
}
