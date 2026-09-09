// Turning a succeeded run with code changes into an open PR: changed-file count, PR body, cross-links, the auto-merge CI gate, and opt-in auto-review.
import { handlePrCreationFailure } from "./agent-watcher-pr-failure.js";
import { projectFor } from "../../outbound/project-boot.js";
import { memoryLifecycle, pipeline, taskStore } from "../../outbound/queues.js";
import { writeEpisodeWithCuration, errorMessage } from "@re-cinq/lore-shared";
import { tryAutoMergeForCompletedTask } from "../merge/auto-merge-trigger.js";
import { prFooter, linkifyMarkdown } from "@re-cinq/lore-shared";
import { generateArtifactCopy } from "../../outbound/artifact-copy.js";
import { maybeStartAutoReview } from "./agent-watcher-auto-review.js";
import {
  decideCiGate,
  decideFeatureLink,
  taskPageUrl,
  stampPrOnOpenRuns,
} from "../../domain/agent-watcher-logic.js";
import {
  type AgentContext,
  getIssueNumber,
  linkPrToIssue,
  notifyTaskUpdate,
} from "./agent-watcher-notify.js";
import { completeNoChangeTask } from "./agent-watcher-no-change.js";

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

export interface OpenedPr {
  pr: Awaited<
    ReturnType<Awaited<ReturnType<typeof projectFor>>["pulls"]["open"]>
  >;
  targetRepo: string;
  issueNumber: number | null;
  changedFiles: number;
  prProject: Awaited<ReturnType<typeof projectFor>>;
}

async function openPrAndRecord(
  ctx: AgentContext,
  changedFiles: number,
): Promise<Omit<OpenedPr, "changedFiles">> {
  const { taskId, branch, targetRepo } = ctx;
  const { issue_number, target_repo } = await getIssueNumber(taskId);
  const prProject = await projectFor(targetRepo);
  const pr = await prProject.pulls.open(
    branch,
    await prCopy(ctx, changedFiles, issue_number),
  );

  await recordPrOpened(taskId, branch, pr);

  return { pr, targetRepo: target_repo, issueNumber: issue_number, prProject };
}

/** The PR's title and body. The footer carries `Lore-Task:` (and the Issue ref when there is one) — in dark-factory mode that trailer is the ONLY cross-reference between the PR and the task that produced it. */
async function prCopy(
  ctx: AgentContext,
  changedFiles: number,
  issueNumber: number | null,
): Promise<{ title: string; body: string }> {
  const { taskId, branch, targetRepo } = ctx;
  const copy = await prArtifactCopy(ctx, changedFiles);
  const body = linkifyMarkdown(copy.body, {
    repo: targetRepo,
    branch,
    uiUrl: process.env.LORE_UI_URL,
  });

  return {
    title: copy.title,
    body: `${body}${prFooter({ issueNumber, taskId })}`,
  };
}

/** The generated title/body pair before the Lore footer and repo-relative link rewriting are applied. */
function prArtifactCopy(ctx: AgentContext, changedFiles: number) {
  return generateArtifactCopy({
    kind: "pr",
    taskType: ctx.taskType,
    description: ctx.description,
    agentOutput: ctx.output,
    changedFiles,
    repo: ctx.targetRepo,
  });
}

/** Records the open PR against the task and any runs awaiting it. The stamp is best-effort and OUTSIDE the failure path: the PR is already open, so a stamp failure must not re-label this as a PR-open failure. */
async function recordPrOpened(
  taskId: string,
  branch: string,
  pr: { url: string; number: number },
): Promise<void> {
  await taskStore().setStatus(taskId, "pr-created", {
    pr_url: pr.url,
    pr_number: pr.number,
    target_branch: branch,
    log_url: taskPageUrl(taskId, process.env.LORE_UI_URL),
  });
  await stampPrOnOpenRuns(pipeline().assemblyRuns, taskId, pr).catch((err) =>
    console.warn(
      `[agent-watcher] stampPrOnOpenRuns failed for ${taskId} — await-pr route may be unresolvable: ${errorMessage(err)}`,
    ),
  );
  await taskStore().recordEvent(taskId, "running", "pr-created", {
    pr_url: pr.url,
  });
}

/** Issue cross-link, feature-row link, and the completion episode/notification — every write a freshly opened PR needs told about it. */
async function linkPrArtifacts(
  ctx: AgentContext,
  opened: OpenedPr,
): Promise<void> {
  const { pr, targetRepo, issueNumber, prProject } = opened;

  await linkPrToIssue(targetRepo, issueNumber, pr.url);
  await linkFeatureRow(ctx, pr, prProject);

  console.log(`[agent-watcher] Task ${ctx.taskId} → PR ${pr.url}`);
  await notifyTaskUpdate(ctx.taskId, targetRepo, "pr", pr.url);
  recordPrEpisode(ctx, opened);
}

/** Links a spec PR back to its feature row (ADR-027). Warned rather than thrown: the PR is open either way. */
async function linkFeatureRow(
  ctx: AgentContext,
  pr: OpenedPr["pr"],
  prProject: Awaited<ReturnType<typeof projectFor>>,
): Promise<void> {
  try {
    await transitionFeatureToPrOpen(ctx, pr, prProject);
  } catch (err) {
    console.warn(
      `[agent-watcher] feature link failed for ${ctx.taskId}: ${errorMessage(err)}`,
    );
  }
}

/** Keyed on the task CARRYING a feature rather than on its type (FR6.26) — a task type is not evidence of a feature, and the context bundle is. */
async function transitionFeatureToPrOpen(
  ctx: AgentContext,
  pr: OpenedPr["pr"],
  prProject: Awaited<ReturnType<typeof projectFor>>,
): Promise<void> {
  const link = decideFeatureLink(
    ctx.taskType,
    (await taskStore().getById(ctx.taskId))?.context_bundle as
      { feature_id?: string; slug?: string } | undefined,
  );

  if (!link) {
    return;
  }

  await prProject.features.transitionStatus(link.featureId, "pr-open", {
    spec_pr_url: pr.url,
    spec_pr_number: pr.number,
    ...(link.slug ? { spec_path: `specs/${link.slug}/spec.md` } : {}),
  });
}

/** The PR is worth remembering with its size and intent — curated so a later task can find what this change already covered. */
function recordPrEpisode(ctx: AgentContext, opened: OpenedPr): void {
  const { taskId, taskType, description } = ctx;

  writeEpisodeWithCuration(
    { memory: memoryLifecycle() },
    {
      content: `Task ${taskType} on ${opened.targetRepo}: created PR ${opened.pr.url}\nChanged files: ${opened.changedFiles}\nDescription: ${description.substring(0, 500)}`,
      source: "ci",
      ref: `${opened.targetRepo}/${taskId}`,
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
  const gate = await probeCiGate(prProject, branch);

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

/** A probe failure counts as proceed: auto-merge re-checks CI itself, so a flaky read must not strand a mergeable PR. */
async function probeCiGate(
  prProject: Awaited<ReturnType<typeof projectFor>>,
  branch: string,
): Promise<"proceed" | "defer"> {
  try {
    return decideCiGate(await prProject.pulls.ciConclusion(branch));
  } catch {
    return "proceed";
  }
}
