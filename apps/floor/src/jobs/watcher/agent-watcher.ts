/**
 * Agent CR (agents.re-cinq.com) processing (ADR-031). The decisions that differ
 * from a LoreTask (Agent.status carries no changedFiles / reviewResult / taskType,
 * and the deterministic gate is the repo's GitHub Actions conclusion, D3) live in
 * agent-watcher-logic.ts; this is the IO shell.
 *
 * `processAgentCr` is a thin dispatcher: it derives the common context, applies the
 * DB re-entry guard, and routes a terminal CR to one of the extracted handlers
 * (`handleSucceededChanges` → no-changes / PR, `handleFailure`, `handleReviewVerdict`).
 *
 * Event-driven (the event bus): the k8s watch emits `kubernetes.agent.{succeeded,
 * failed}` events; the handler re-GETs the CR and calls `processAgentCr`. The
 * reconcile path (k8s-watch listener) lists CRs, emits for terminal-unhandled ones,
 * and prunes old terminal CRs.
 */

import { KubeConfig, CustomObjectsApi } from "@kubernetes/client-node";
import type { Agent as AgentCr } from "@re-cinq/agent-contracts";
import { projectFor } from "../../composition/project-boot.js";
import { taskStore, settings, taskQueue } from "../../kernel/queues.js";
import { writeEpisode, writeEpisodeWithCuration } from "../lib/episode-writer.js";
import { tryAutoMergeForCompletedTask } from "../merge/auto-merge-trigger.js";
import { isTransientInfraFailure, MAX_INFRA_RETRIES } from "../platform/infra-failure.js";
import { buildReviewFixDescription, formatReviewFeedback, prFooter, linkifyMarkdown } from "@re-cinq/lore-shared";
import { generateArtifactCopy } from "../lib/artifact-copy.js";
import { shouldAutoReview } from "../review/should-auto-review.js";
import {
  taskIdOf,
  taskTypeOf,
  parseReviewResult,
  decideCiGate,
  type ReviewResult,
} from "./agent-watcher-logic.js";
import {
  KubeTokenProvisioner,
  GithubTokenMinter,
  KubeSecretKeyWriter,
  KubeCatalogApi,
} from "../station/kube-token-provisioner.js";
import { PlatformGitHub } from "@re-cinq/lore-shared/project/lib/platform-github.js";

const GROUP = "agents.re-cinq.com";
const VERSION = "v1alpha1";
const PLURAL = "agents";

export function agentsNamespace(): string {
  return process.env.LORE_AGENTS_NAMESPACE ?? "ai-agents";
}

function logUrlFor(repo: string, taskId: string): string {
  return `gs://${process.env.LORE_LOG_BUCKET || "lore-task-logs"}/${repo}/${taskId}/output.log`;
}

/** Agent output can be large — keep only the tail for issue/PR bodies. */
function tailOutput(output: string, limit = 60000): string {
  return output.length > limit ? output.slice(-limit) + "\n\n…(truncated)" : output;
}

/** Best-effort removal of a terminal task's per-task token key + AgentDefinition/Station
 *  triple (#697). Idempotent (404s ignored); co-located with Agent-CR deletion. */
function cleanupPerTaskToken(taskId: string): Promise<void> {
  return new KubeTokenProvisioner(
    new GithubTokenMinter(new PlatformGitHub(process.env)),
    new KubeSecretKeyWriter(),
    new KubeCatalogApi(),
  )
    .cleanup(taskId)
    .catch(() => {});
}

// ── Slack batching (per invocation) ──────────
// Batching is per-`processAgentCr` call — a module-level array raced across two
// concurrent CR events (one call's flush could truncate the other's queued entries).

interface SlackBatchEntry {
  repo: string;
  taskId: string;
  type: "pr" | "completed" | "failed";
  message: string;
}

class SlackBatch {
  private readonly entries: SlackBatchEntry[] = [];

  queue(repo: string, taskId: string, type: SlackBatchEntry["type"], message: string): void {
    this.entries.push({ repo, taskId, type, message });
  }

  async flush(): Promise<void> {
    if (this.entries.length === 0) return;
    const byRepo = new Map<string, SlackBatchEntry[]>();
    for (const entry of this.entries) {
      if (!byRepo.has(entry.repo)) byRepo.set(entry.repo, []);
      byRepo.get(entry.repo)!.push(entry);
    }
    for (const [repo, entries] of byRepo) {
      if (entries.length === 1) {
        const e = entries[0];
        const msg = e.type === "pr" ? `PR ready for review: ${e.message}`
          : e.type === "completed" ? `Task completed: ${e.message}`
          : `Task failed: ${e.message}`;
        await notifySlack(e.taskId, repo, msg).catch(() => {});
        continue;
      }
      const prs = entries.filter((e) => e.type === "pr");
      const completed = entries.filter((e) => e.type === "completed");
      const failed = entries.filter((e) => e.type === "failed");
      const parts: string[] = [];
      if (prs.length > 0) parts.push(`*${prs.length} PRs ready for review:*\n${prs.map((e) => `• ${e.message}`).join("\n")}`);
      if (completed.length > 0) parts.push(`*${completed.length} tasks completed:*\n${completed.map((e) => `• ${e.message}`).join("\n")}`);
      if (failed.length > 0) {
        const first = failed[0].message;
        parts.push(failed.length === 1 ? `*1 task failed:*\n• ${first}` : `*${failed.length} tasks failed* (first error: ${first.substring(0, 100)})`);
      }
      const summary = `*${repo}* — ${entries.length} task updates\n\n${parts.join("\n\n")}`;
      await notifySlack(entries[0].taskId, repo, summary).catch(() => {});
    }
    this.entries.length = 0;
  }
}

// ── Helpers (CR-agnostic) ─────────────────

async function notifySlack(taskId: string, repo: string, message: string): Promise<void> {
  const botToken = process.env.LORE_SLACK_BOT_TOKEN;
  if (!botToken) return;
  const bundle = (await taskStore().getById(taskId))?.context_bundle as
    | { slack_channel_id?: string }
    | undefined;
  let channel = bundle?.slack_channel_id;
  if (!channel) {
    const repoSettings = (await settings().rawSettings(repo)) as { slack_channel_id?: string } | null;
    channel = repoSettings?.slack_channel_id;
  }
  if (!channel) return;
  try {
    await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: { Authorization: `Bearer ${botToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ channel, text: message, unfurl_links: true }),
    });
  } catch { /* best effort */ }
}

async function getIssueNumber(taskId: string): Promise<{ issue_number: number | null; target_repo: string }> {
  const task = await taskStore().getById(taskId);
  if (!task) return { issue_number: null, target_repo: "" };
  return { issue_number: task.issue_number ?? null, target_repo: task.target_repo };
}
async function linkPrToIssue(repo: string, issueNumber: number | null, prUrl: string): Promise<void> {
  if (!issueNumber) return;
  try {
    const project = await projectFor(repo);
    await project.issues.comment(issueNumber, `PR created: ${prUrl}`);
    await project.issues.close(issueNumber, "completed");
  } catch { /* best effort */ }
}
async function commentFailureOnIssue(repo: string, issueNumber: number | null, reason: string): Promise<void> {
  if (!issueNumber) return;
  try {
    const project = await projectFor(repo);
    await project.issues.comment(issueNumber, `Task failed: \`${reason}\``);
    await project.issues.addLabel(issueNumber, "lore-failed");
  } catch { /* best effort */ }
}

/** Mark an Agent's status so the watcher does not re-process it. Best effort. */
async function patchAgentStatus(k8sApi: CustomObjectsApi, name: string, patch: Record<string, unknown>): Promise<void> {
  const namespace = agentsNamespace();
  try {
    const current = (await k8sApi.getNamespacedCustomObjectStatus({
      group: GROUP, version: VERSION, namespace, plural: PLURAL, name,
    })) as any;
    await k8sApi.replaceNamespacedCustomObjectStatus({
      group: GROUP, version: VERSION, namespace, plural: PLURAL, name,
      body: { ...current, status: { ...current.status, ...patch } },
    });
  } catch { /* best effort — CR may already be cleaned up */ }
}

/** Construct the in-cluster Agent CR API client + namespace. */
export function makeAgentsApi(): { k8sApi: CustomObjectsApi; namespace: string } {
  const kc = new KubeConfig();
  kc.loadFromCluster();
  return { k8sApi: kc.makeApiClient(CustomObjectsApi), namespace: agentsNamespace() };
}

/** The derived context threaded through the per-outcome handlers. */
interface AgentContext {
  k8sApi: CustomObjectsApi;
  taskId: string;
  taskType: string;
  branch: string;
  targetRepo: string;
  description: string;
  output: string;
  name: string;
  slack: SlackBatch;
}

/**
 * Process one terminal Agent CR. Invoked by the `kubernetes.agent.{succeeded,failed}`
 * event handlers (the event carries the agent name; the handler re-GETs the fresh
 * CR). Derives the context, applies the DB re-entry guard, and dispatches to the
 * matching handler; the Slack flush runs in `finally` so an early return still
 * delivers notifications.
 */
export async function processAgentCr(agent: AgentCr, k8sApi: CustomObjectsApi): Promise<void> {
  const status = agent.status ?? {};
  const phase = status.phase;
  const taskId = taskIdOf(agent);
  if (!taskId) return;

  const ctx: AgentContext = {
    k8sApi,
    taskId,
    taskType: taskTypeOf(agent) ?? "general",
    branch: agent.spec?.branch ?? "",
    targetRepo: agent.spec?.targetRepo ?? "",
    description: agent.spec?.parameters?.description ?? "",
    output: status.output ?? "",
    name: agent.metadata?.name as string,
    slack: new SlackBatch(),
  };

  try {
    // DB-level re-entry guard (only act on tasks still running/queued). A CR whose
    // taskId has no backing pipeline task is a task-less assembly line (e.g.
    // code-review, keyed on its assemblyLineId): the supervisor owns the run, so the
    // watcher has nothing to reconcile — return before any PR/no-changes work.
    if (phase === "Succeeded" || phase === "Failed") {
      const task = await taskStore().getById(taskId);
      if (!task) return;
      if (!["running", "queued"].includes(task.status)) return;
    }

    if (phase === "Succeeded" && !status.prUrl && ctx.taskType !== "review") {
      await handleSucceededChanges(ctx);
    }

    if (phase === "Failed" && status.failureReason) {
      await handleFailure(ctx, status.failureReason);
    }

    // Review verdict (parsed from status.output — Agent has no reviewResult field).
    const reviewResult = phase === "Succeeded" && ctx.taskType === "review" ? parseReviewResult(ctx.output) : undefined;
    if (reviewResult) {
      await handleReviewVerdict(ctx, reviewResult);
    }
  } finally {
    await ctx.slack.flush();
  }
}

/** Succeeded, non-review, no PR yet: compute the changed-file count and either close
 *  out a no-changes task (issue) or open a PR (+ CI gate, auto-review fan-out). */
async function handleSucceededChanges(ctx: AgentContext): Promise<void> {
  const { taskId, taskType, branch, targetRepo, description, output, name, k8sApi } = ctx;
  const logUrl = logUrlFor(targetRepo, taskId);

  // Agent.status has no changedFiles — compute it via compare-commits.
  let changedFiles = 0;
  try {
    const proj = await projectFor(targetRepo);
    const base = await proj.repo.defaultBranch();
    changedFiles = await proj.pulls.changedFileCount(base, branch);
  } catch (err: any) {
    console.warn(`[agent-watcher] changed-file count failed for ${taskId}: ${err.message}`);
  }

  if (changedFiles === 0) {
    // feature-planning posts its result straight to the features API (ADR-027).
    if (taskType === "feature-planning") {
      try {
        await taskStore().setStatus(taskId, "completed");
        await taskStore().recordEvent(taskId, "running", "completed", { feature_planning: true });
        await patchAgentStatus(k8sApi, name, { prUrl: "feature-planning" });
      } catch (err: any) {
        console.error(`[agent-watcher] feature-planning completion failed for ${taskId}: ${err.message}`);
      }
      return;
    }
    try {
      let { issue_number, target_repo } = await getIssueNumber(taskId);
      if (!target_repo) target_repo = targetRepo;
      if (!issue_number) {
        try {
          const copy = await generateArtifactCopy({ kind: "issue", taskType, description, agentOutput: output, repo: target_repo });
          const body = output
            ? `${tailOutput(output)}\n\n---\n*Lore-Task: ${taskId}*`
            : `${copy.body}\n\nTask completed (no output). See [logs](${logUrl}).`;
          const issue = await (await projectFor(target_repo)).issues.create(copy.title, body, ["lore-managed", taskType]);
          issue_number = issue.number;
          await taskQueue().setColumns(taskId, { issue_number: issue.number, issue_url: issue.url });
        } catch { /* best effort */ }
      } else {
        const body = output
          ? `## Result\n\n${tailOutput(output)}`
          : "Task completed (no code changes). See logs for full output.";
        await projectFor(target_repo).then((p) => p.issues.comment(issue_number!, body)).catch(() => {});
      }
      await taskStore().setStatus(taskId, "completed", { log_url: logUrl });
      await taskStore().recordEvent(taskId, "running", "completed", { no_changes: true, issue_number });
      await patchAgentStatus(k8sApi, name, { prUrl: "no-changes", issueNumber: issue_number });
      if (issue_number) ctx.slack.queue(target_repo, taskId, "completed", `https://github.com/${target_repo}/issues/${issue_number}`);
      writeEpisode(
        `Task ${taskType} on ${target_repo} completed (no changes)\nDescription: ${description.substring(0, 500)}\nOutput: ${output.substring(0, 2000)}`,
        "ci", `${target_repo}/${taskId}`,
      ).catch(() => {});
      console.log(`[agent-watcher] Task ${taskId} completed → issue #${issue_number || "none"}`);
    } catch (err: any) {
      console.error(`[agent-watcher] Failed to complete no-change task ${taskId}: ${err.message}`);
    }
    return;
  }

  // Open a PR from the pushed branch.
  const namespace = agentsNamespace();
  try {
    const { issue_number, target_repo } = await getIssueNumber(taskId);
    const footer = prFooter({ issueNumber: issue_number, taskId });
    const copy = await generateArtifactCopy({ kind: "pr", taskType, description, agentOutput: output, changedFiles, repo: targetRepo });
    const body = linkifyMarkdown(copy.body, { repo: targetRepo, branch, uiUrl: process.env.LORE_UI_URL });
    const prProject = await projectFor(targetRepo);
    const pr = await prProject.pulls.open(branch, copy.title, `${body}${footer}`);

    await taskStore().setStatus(taskId, "pr-created", {
      pr_url: pr.url,
      pr_number: pr.number,
      target_branch: branch,
      log_url: logUrl,
    });
    await taskStore().recordEvent(taskId, "running", "pr-created", { pr_url: pr.url });
    await linkPrToIssue(target_repo, issue_number, pr.url);
    await patchAgentStatus(k8sApi, name, { prUrl: pr.url, prNumber: pr.number });

    // feature-finalize: link the PR back to the feature row (ADR-027).
    if (taskType === "feature-finalize") {
      try {
        const contextBundle = (await taskStore().getById(taskId))?.context_bundle as
          | { feature_id?: string; slug?: string }
          | undefined;
        const featureId = contextBundle?.feature_id;
        const slug = contextBundle?.slug;
        if (featureId) {
          await prProject.features.transitionStatus(featureId, "pr-open", {
            spec_pr_url: pr.url, spec_pr_number: pr.number, ...(slug ? { spec_path: `specs/${slug}/spec.md` } : {}),
          });
        }
      } catch (err: any) {
        console.warn(`[agent-watcher] feature-finalize link failed for ${taskId}: ${err.message}`);
      }
    }

    console.log(`[agent-watcher] Task ${taskId} → PR ${pr.url}`);
    ctx.slack.queue(targetRepo, taskId, "pr", pr.url);
    writeEpisodeWithCuration(
      `Task ${taskType} on ${targetRepo}: created PR ${pr.url}\nChanged files: ${changedFiles}\nDescription: ${description.substring(0, 500)}`,
      "ci", `${targetRepo}/${taskId}`, "agent-watcher", taskId,
    ).catch(() => {});

    // Deterministic CI gate (D3): only fire auto-merge once CI is green; a red or
    // still-running CI defers (the webhook-driven re-trigger re-fires when CI
    // completes). tryAutoMergeForCompletedTask also re-checks CI itself, so this
    // is belt-and-suspenders that keeps the watcher's gate explicit.
    let gate: "proceed" | "defer" = "proceed";
    try {
      gate = decideCiGate(await prProject.pulls.ciConclusion(branch));
    } catch { /* treat probe failure as proceed; auto-merge re-checks */ }
    if (gate === "proceed") {
      tryAutoMergeForCompletedTask({ taskId }).catch((err) =>
        console.warn(`[agent-watcher] auto-merge trigger failed for task ${taskId}:`, (err as Error).message));
    } else {
      console.log(`[agent-watcher] CI not green for ${taskId} — deferring auto-merge to the webhook re-trigger`);
    }

    if (await shouldAutoReview(targetRepo)) {
      const reviewTaskId = (await taskQueue().insertTask({
        description: `Review PR #${pr.number} on ${targetRepo}`,
        taskType: "review",
        targetRepo,
        createdBy: "agent-watcher",
        contextBundle: { pr_number: pr.number, branch, parent_task_id: taskId },
      })) as string;
      await (await projectFor(targetRepo)).agents.run(reviewTaskId, {
        mode: "cluster", taskType: "review",
        description: `Review PR #${pr.number} on ${targetRepo}`,
        prompt: `Review PR #${pr.number} on this branch. Read the spec in specs/ for the feature requirements. Check all changes against CLAUDE.md conventions and ADRs in adrs/. Post specific review comments on the PR using 'gh pr review'. Then output exactly one of:\n- REVIEW_RESULT:APPROVED\n- REVIEW_RESULT:CHANGES_REQUESTED:<specific actionable feedback>`,
        branch, prNumber: pr.number, model: "claude-sonnet-4-6", timeoutMinutes: 10,
      });
      await taskStore().setStatus(taskId, "review");
      await taskStore().recordEvent(taskId, "pr-created", "review", { review_task_id: reviewTaskId, auto_review: true });
      console.log(`[agent-watcher] Auto-review: created review task ${reviewTaskId} for PR #${pr.number}`);
    }
  } catch (err: any) {
    const msg = String(err?.message || err);
    console.error(`[agent-watcher] Failed to create PR for ${taskId}: ${msg}`);
    const isNoCommits = /No commits between/i.test(msg);
    const isPrExists = /A pull request already exists/i.test(msg);
    if (isNoCommits || isPrExists) {
      const reason = isNoCommits ? "no-code-changes" : "pr-already-exists";
      await taskStore()
        .setStatus(taskId, "needs-human-help", { failure_reason: `createPR failed: ${reason}. ${msg.substring(0, 300)}` })
        .catch(() => {});
      await taskStore()
        .recordEvent(taskId, "running", "needs-human-help", { reason, detected_by: "agent-watcher", error: msg.substring(0, 500) })
        .catch(() => {});
      try {
        await k8sApi.deleteNamespacedCustomObject({ group: GROUP, version: VERSION, namespace, plural: PLURAL, name });
      } catch { /* already gone */ }
      await cleanupPerTaskToken(taskId);
      console.log(`[agent-watcher] Marked ${taskId} needs-human-help (${reason})`);
    }
  }
}

/** Failed CR: record the failure, with a bounded transient-infra re-queue. */
async function handleFailure(ctx: AgentContext, reason: string): Promise<void> {
  const { taskId, taskType, targetRepo, description, output } = ctx;
  const failedTask = await taskStore().getById(taskId);
  const bundle = failedTask?.context_bundle ?? {};
  const infraRetries = Number(bundle.infra_retry_count ?? 0);
  const logUrl = logUrlFor(targetRepo, taskId);

  if (failedTask?.status === "running" && isTransientInfraFailure(reason) && infraRetries < MAX_INFRA_RETRIES) {
    await taskStore().setStatus(taskId, "failed", { failure_reason: reason, log_url: logUrl });
    await taskStore().recordEvent(taskId, "running", "failed", { error: reason, transient_infra: true, infra_retry: infraRetries + 1 });
    const requeuedId = await taskQueue().insertTask({
      description,
      taskType,
      status: "pending",
      targetRepo,
      createdBy: failedTask.created_by,
      contextBundle: { ...bundle, infra_retry_count: infraRetries + 1, retry_of: taskId },
    });
    if (requeuedId && failedTask.issue_number != null) {
      await taskQueue().setColumns(requeuedId, { issue_number: failedTask.issue_number });
    }
    console.log(`[agent-watcher] Task ${taskId} transient infra failure (${reason}) — re-queued ${infraRetries + 1}/${MAX_INFRA_RETRIES}`);
  } else if (failedTask?.status === "running") {
    await taskStore().setStatus(taskId, "failed", { failure_reason: reason, log_url: logUrl });
    await taskStore().recordEvent(taskId, "running", "failed", { error: reason });
    await commentFailureOnIssue(failedTask.target_repo, failedTask.issue_number ?? null, reason);
    ctx.slack.queue(failedTask.target_repo, taskId, "failed", `${taskType}: ${reason.substring(0, 200)}`);
    writeEpisodeWithCuration(
      `Task failed on ${targetRepo}: ${taskType}\n\nDescription: ${description}\n\nFailure: ${reason}\n\nOutput:\n${output.slice(-2000)}`,
      "ci", `${targetRepo}/${taskId}`, "agent-watcher", taskId,
    ).catch(() => {});
    console.log(`[agent-watcher] Task ${taskId} failed: ${reason}`);
  }
}

/** A review Agent's verdict drives the iteration-capped fix loop on the parent task. */
async function handleReviewVerdict(ctx: AgentContext, reviewResult: ReviewResult): Promise<void> {
  const { taskId, branch } = ctx;
  const reviewTask = await taskStore().getById(taskId);
  if (reviewTask && reviewTask.status !== "running") return;
  const contextBundle = reviewTask?.context_bundle as { parent_task_id?: string } | undefined;
  const parentTaskId: string | undefined = contextBundle?.parent_task_id;
  if (!parentTaskId) { console.log(`[agent-watcher] Review ${taskId} has no parent task, skipping`); return; }

  if (reviewResult === "approved") {
    await taskStore().setStatus(parentTaskId, "completed");
    await taskStore().recordEvent(parentTaskId, "review", "completed", { review_result: "approved", review_task_id: taskId });
    const { issue_number, target_repo } = await getIssueNumber(parentTaskId);
    if (issue_number) await projectFor(target_repo).then((p) => p.issues.comment(issue_number, "Agent review: **approved**. PR is ready for human merge.")).catch(() => {});
    await taskStore().setStatus(taskId, "completed");
    console.log(`[agent-watcher] Review approved for parent task ${parentTaskId}`);
  } else {
    const parent = await taskStore().getById(parentTaskId);
    if (!parent) return;
    const iteration = (Number(parent.review_iteration) || 0) + 1;
    await taskQueue().setColumns(parentTaskId, { review_iteration: iteration });

    if (iteration >= 2) {
      await taskStore().recordEvent(parentTaskId, "review", "review", { review_result: "needs-human-review", iterations: iteration });
      if (parent.issue_number) {
        await projectFor(parent.target_repo).then((p) => p.issues.comment(parent.issue_number!, `Agent review: changes requested (iteration ${iteration}/2). Escalating to human review.`)).catch(() => {});
        await projectFor(parent.target_repo).then((p) => p.issues.addLabel(parent.issue_number!, "needs-human-review")).catch(() => {});
      }
      await taskStore().setStatus(taskId, "completed");
      console.log(`[agent-watcher] Review escalated to human for ${parentTaskId} (iteration ${iteration})`);
    } else {
      const comments = parent.pr_number ? await projectFor(parent.target_repo).then((p) => p.pulls.listComments(parent.pr_number!)).catch(() => []) : [];
      const feedback = formatReviewFeedback(comments) || "The agent review requested changes. Read the review comments on the PR and address them.";
      const fixDescription = buildReviewFixDescription({ prNumber: parent.pr_number ?? null, iteration });
      const fixTaskId = (await taskQueue().insertTask({
        description: fixDescription,
        taskType: "implementation",
        targetRepo: parent.target_repo,
        createdBy: "review-loop",
        contextBundle: { branch: parent.target_branch, review_feedback: feedback, parent_task_id: parentTaskId },
      })) as string;
      await (await projectFor(parent.target_repo)).agents.run(fixTaskId, {
        mode: "cluster", taskType: "implementation", description: fixDescription,
        prompt: `Address the following review feedback on PR #${parent.pr_number ?? "?"}. The PR already exists — push fixes to the same branch.\n\nFeedback:\n${feedback}`,
        branch: parent.target_branch || branch, model: "claude-sonnet-4-6", timeoutMinutes: 30,
      });
      if (parent.issue_number) await projectFor(parent.target_repo).then((p) => p.issues.comment(parent.issue_number!, `Agent review: changes requested (iteration ${iteration}/2). Auto-fixing...`)).catch(() => {});
      await taskStore().setStatus(taskId, "completed");
      console.log(`[agent-watcher] Review changes requested, created fix task ${fixTaskId} (iteration ${iteration})`);
    }
  }
}

/** A no-changes Agent we already closed out carries the prUrl sentinel "no-changes". */
export function changedFilesIsZero(status: NonNullable<AgentCr["status"]>): boolean {
  return status.prUrl === "no-changes";
}
