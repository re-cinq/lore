/**
 * Agent CR (agents.re-cinq.com) processing (ADR-031). The decisions that differ
 * from a LoreTask (Agent.status carries no changedFiles / reviewResult / taskType,
 * and the deterministic gate is the repo's GitHub Actions conclusion, D3) live in
 * agent-watcher-logic.ts; this is the IO shell.
 *
 * On Succeeded: compute the changed-file count via compare-commits → open a PR (or
 * close out a no-changes task), gate auto-merge on green CI, and fan out auto-review.
 * On Failed: record the failure (with bounded transient-infra retry). Review verdicts
 * (parsed from status.output) drive the iteration-capped fix loop.
 *
 * Event-driven (the event bus): the k8s watch emits `kubernetes.agent.{succeeded,
 * failed}` events; the handler re-GETs the CR and calls `processAgentCr`. The
 * reconcile path (k8s-watch listener) lists CRs, emits for terminal-unhandled ones,
 * and prunes old terminal CRs.
 */

import { KubeConfig, CustomObjectsApi } from "@kubernetes/client-node";
import type { Agent } from "@re-cinq/agent-contracts";
import { projectFor } from "../composition/project-boot.js";
import { query } from "../kernel/db.js";
import { writeEpisode, writeEpisodeWithCuration } from "../memory/episode-writer.js";
import { tryAutoMergeForCompletedTask } from "../merge/auto-merge-trigger.js";
import { isTransientInfraFailure, MAX_INFRA_RETRIES } from "../platform/infra-failure.js";
import { buildReviewFixDescription, formatReviewFeedback, prFooter, linkifyMarkdown } from "@re-cinq/lore-shared";
import { generateArtifactCopy } from "../platform/artifact-copy.js";
import {
  taskIdOf,
  taskTypeOf,
  parseReviewResult,
  decideCiGate,
} from "./agent-watcher-logic.js";
import {
  KubeTokenProvisioner,
  GithubTokenMinter,
  KubeSecretKeyWriter,
  KubeCatalogApi,
} from "../station/kube-token-provisioner.js";
import { GitHubPlatform } from "../platform/github.js";

const GROUP = "agents.re-cinq.com";
const VERSION = "v1alpha1";
const PLURAL = "agents";

export function agentsNamespace(): string {
  return process.env.LORE_AGENTS_NAMESPACE ?? "ai-agents";
}

/** Best-effort removal of a terminal task's per-task token key + AgentDefinition/Station
 *  triple (#697). Idempotent (404s ignored); co-located with Agent-CR deletion. */
function cleanupPerTaskToken(taskId: string): Promise<void> {
  return new KubeTokenProvisioner(
    new GithubTokenMinter(new GitHubPlatform()),
    new KubeSecretKeyWriter(),
    new KubeCatalogApi(),
  )
    .cleanup(taskId)
    .catch(() => {});
}

// ── Slack batching (CR-agnostic) ──────────

interface SlackBatchEntry {
  repo: string;
  taskId: string;
  type: "pr" | "completed" | "failed";
  message: string;
}
const slackBatch: SlackBatchEntry[] = [];
function queueSlackNotification(repo: string, taskId: string, type: SlackBatchEntry["type"], message: string): void {
  slackBatch.push({ repo, taskId, type, message });
}
async function flushSlackBatch(): Promise<void> {
  if (slackBatch.length === 0) return;
  const byRepo = new Map<string, SlackBatchEntry[]>();
  for (const entry of slackBatch) {
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
  slackBatch.length = 0;
}

// ── Helpers (CR-agnostic) ─────────────────

async function notifySlack(taskId: string, repo: string, message: string): Promise<void> {
  const botToken = process.env.LORE_SLACK_BOT_TOKEN;
  if (!botToken) return;
  const bundle = (await query<{ context_bundle: any }>(
    `SELECT context_bundle FROM pipeline.tasks WHERE id = $1`, [taskId],
  ))[0]?.context_bundle;
  let channel = bundle?.slack_channel_id;
  if (!channel) {
    const repoRows = await query<{ settings: any }>(`SELECT settings FROM lore.repos WHERE full_name = $1`, [repo]);
    channel = repoRows[0]?.settings?.slack_channel_id;
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

async function shouldAutoReview(repo: string): Promise<boolean> {
  const rows = await query<{ settings: any }>(`SELECT settings FROM lore.repos WHERE full_name = $1`, [repo]);
  return rows[0]?.settings?.auto_review === true;
}
async function getIssueNumber(taskId: string): Promise<{ issue_number: number | null; target_repo: string }> {
  const rows = await query<{ issue_number: number | null; target_repo: string }>(
    `SELECT issue_number, target_repo FROM pipeline.tasks WHERE id = $1`, [taskId],
  );
  return rows[0] || { issue_number: null, target_repo: "" };
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

/**
 * Process one terminal Agent CR. Invoked by the `kubernetes.agent.{succeeded,failed}`
 * event handlers (the event carries the agent name; the handler re-GETs the fresh
 * CR). The body is the former list-loop body verbatim, with `continue`→`return`;
 * the Slack flush runs in `finally` so an early return still delivers notifications.
 */
export async function processAgentCr(agent: Agent, k8sApi: CustomObjectsApi): Promise<void> {
  const namespace = agentsNamespace();
  try {
    const status = agent.status ?? {};
    const phase = status.phase;
    const taskId = taskIdOf(agent);
    if (!taskId) return;
    const taskType = taskTypeOf(agent) ?? "general";
    const branch = agent.spec?.branch ?? "";
    const targetRepo = agent.spec?.targetRepo ?? "";
    const description = agent.spec?.parameters?.description ?? "";
    const output = status.output ?? "";
    const name = agent.metadata?.name as string;

    // DB-level re-entry guard (only act on tasks still running/queued).
    if (phase === "Succeeded" || phase === "Failed") {
      const dbStatus = (await query<{ status: string }>(`SELECT status FROM pipeline.tasks WHERE id = $1`, [taskId]))[0]?.status;
      if (dbStatus && !["running", "queued"].includes(dbStatus)) return;
    }

    if (phase === "Succeeded" && !status.prUrl && taskType !== "review") {
      const logUrl = `gs://${process.env.LORE_LOG_BUCKET || "lore-task-logs"}/${targetRepo}/${taskId}/output.log`;

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
            await query(`UPDATE pipeline.tasks SET status = 'completed', updated_at = now() WHERE id = $1`, [taskId]);
            await query(
              `INSERT INTO pipeline.task_events (task_id, from_status, to_status, metadata) VALUES ($1, 'running', 'completed', $2)`,
              [taskId, JSON.stringify({ feature_planning: true })],
            );
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
                ? `${output.length > 60000 ? output.slice(-60000) + "\n\n…(truncated)" : output}\n\n---\n*Lore-Task: ${taskId}*`
                : `${copy.body}\n\nTask completed (no output). See [logs](${logUrl}).`;
              const issue = await (await projectFor(target_repo)).issues.create(copy.title, body, ["lore-managed", taskType]);
              issue_number = issue.number;
              await query(`UPDATE pipeline.tasks SET issue_number = $1, issue_url = $2 WHERE id = $3`, [issue.number, issue.url, taskId]);
            } catch { /* best effort */ }
          } else {
            const body = output
              ? `## Result\n\n${output.length > 60000 ? output.slice(-60000) + "\n\n…(truncated)" : output}`
              : "Task completed (no code changes). See logs for full output.";
            await projectFor(target_repo).then((p) => p.issues.comment(issue_number!, body)).catch(() => {});
          }
          await query(`UPDATE pipeline.tasks SET status = 'completed', log_url = $1, updated_at = now() WHERE id = $2`, [logUrl, taskId]);
          await query(
            `INSERT INTO pipeline.task_events (task_id, from_status, to_status, metadata) VALUES ($1, 'running', 'completed', $2)`,
            [taskId, JSON.stringify({ no_changes: true, issue_number })],
          );
          await patchAgentStatus(k8sApi, name, { prUrl: "no-changes", issueNumber: issue_number });
          if (issue_number) queueSlackNotification(target_repo, taskId, "completed", `https://github.com/${target_repo}/issues/${issue_number}`);
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
      try {
        const { issue_number, target_repo } = await getIssueNumber(taskId);
        const footer = prFooter({ issueNumber: issue_number, taskId });
        const copy = await generateArtifactCopy({ kind: "pr", taskType, description, agentOutput: output, changedFiles, repo: targetRepo });
        const body = linkifyMarkdown(copy.body, { repo: targetRepo, branch, uiUrl: process.env.LORE_UI_URL });
        const prProject = await projectFor(targetRepo);
        const pr = await prProject.pulls.open(branch, copy.title, `${body}${footer}`);

        await query(
          `UPDATE pipeline.tasks SET status = 'pr-created', pr_url = $1, pr_number = $2, target_branch = $3, log_url = $4, updated_at = now() WHERE id = $5`,
          [pr.url, pr.number, branch, logUrl, taskId],
        );
        await query(
          `INSERT INTO pipeline.task_events (task_id, from_status, to_status, metadata) VALUES ($1, 'running', 'pr-created', $2)`,
          [taskId, JSON.stringify({ pr_url: pr.url })],
        );
        await linkPrToIssue(target_repo, issue_number, pr.url);
        await patchAgentStatus(k8sApi, name, { prUrl: pr.url, prNumber: pr.number });

        // feature-finalize: link the PR back to the feature row (ADR-027).
        if (taskType === "feature-finalize") {
          try {
            const rows = await query<{ context_bundle: any }>(`SELECT context_bundle FROM pipeline.tasks WHERE id = $1`, [taskId]);
            const featureId = rows[0]?.context_bundle?.feature_id;
            const slug = rows[0]?.context_bundle?.slug;
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
        queueSlackNotification(targetRepo, taskId, "pr", pr.url);
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
          const reviewTaskId = (await query<{ id: string }>(
            `INSERT INTO pipeline.tasks (description, task_type, target_repo, created_by, context_bundle)
             VALUES ($1, 'review', $2, 'agent-watcher', $3) RETURNING id`,
            [`Review PR #${pr.number} on ${targetRepo}`, targetRepo, JSON.stringify({ pr_number: pr.number, branch, parent_task_id: taskId })],
          ))[0].id;
          await (await projectFor(targetRepo)).agents.run(reviewTaskId, {
            mode: "cluster", taskType: "review",
            description: `Review PR #${pr.number} on ${targetRepo}`,
            prompt: `Review PR #${pr.number} on this branch. Read the spec in specs/ for the feature requirements. Check all changes against CLAUDE.md conventions and ADRs in adrs/. Post specific review comments on the PR using 'gh pr review'. Then output exactly one of:\n- REVIEW_RESULT:APPROVED\n- REVIEW_RESULT:CHANGES_REQUESTED:<specific actionable feedback>`,
            branch, prNumber: pr.number, model: "claude-sonnet-4-6", timeoutMinutes: 10,
          });
          await query(`UPDATE pipeline.tasks SET status = 'review', updated_at = now() WHERE id = $1`, [taskId]);
          await query(
            `INSERT INTO pipeline.task_events (task_id, from_status, to_status, metadata) VALUES ($1, 'pr-created', 'review', $2)`,
            [taskId, JSON.stringify({ review_task_id: reviewTaskId, auto_review: true })],
          );
          console.log(`[agent-watcher] Auto-review: created review task ${reviewTaskId} for PR #${pr.number}`);
        }
      } catch (err: any) {
        const msg = String(err?.message || err);
        console.error(`[agent-watcher] Failed to create PR for ${taskId}: ${msg}`);
        const isNoCommits = /No commits between/i.test(msg);
        const isPrExists = /A pull request already exists/i.test(msg);
        if (isNoCommits || isPrExists) {
          const reason = isNoCommits ? "no-code-changes" : "pr-already-exists";
          await query(
            `UPDATE pipeline.tasks SET status = 'needs-human-help', failure_reason = $2, updated_at = now() WHERE id = $1`,
            [taskId, `createPR failed: ${reason}. ${msg.substring(0, 300)}`],
          ).catch(() => {});
          await query(
            `INSERT INTO pipeline.task_events (task_id, from_status, to_status, metadata) VALUES ($1, 'running', 'needs-human-help', $2)`,
            [taskId, JSON.stringify({ reason, detected_by: "agent-watcher", error: msg.substring(0, 500) })],
          ).catch(() => {});
          try {
            await k8sApi.deleteNamespacedCustomObject({ group: GROUP, version: VERSION, namespace, plural: PLURAL, name });
          } catch { /* already gone */ }
          await cleanupPerTaskToken(taskId);
          console.log(`[agent-watcher] Marked ${taskId} needs-human-help (${reason})`);
        }
      }
    }

    if (phase === "Failed" && status.failureReason) {
      const rows = await query<{ status: string; issue_number: number | null; target_repo: string; created_by: string; context_bundle: Record<string, unknown> | null }>(
        `SELECT status, issue_number, target_repo, created_by, context_bundle FROM pipeline.tasks WHERE id = $1`, [taskId],
      );
      const reason = status.failureReason;
      const bundle = rows[0]?.context_bundle ?? {};
      const infraRetries = Number(bundle.infra_retry_count ?? 0);
      const logUrl = `gs://${process.env.LORE_LOG_BUCKET || "lore-task-logs"}/${targetRepo}/${taskId}/output.log`;

      if (rows[0]?.status === "running" && isTransientInfraFailure(reason) && infraRetries < MAX_INFRA_RETRIES) {
        await query(`UPDATE pipeline.tasks SET status = 'failed', failure_reason = $1, log_url = $2, updated_at = now() WHERE id = $3`, [reason, logUrl, taskId]);
        await query(
          `INSERT INTO pipeline.task_events (task_id, from_status, to_status, metadata) VALUES ($1, 'running', 'failed', $2)`,
          [taskId, JSON.stringify({ error: reason, transient_infra: true, infra_retry: infraRetries + 1 })],
        );
        await query(
          `INSERT INTO pipeline.tasks (description, task_type, status, target_repo, created_by, context_bundle, issue_number)
           VALUES ($1, $2, 'pending', $3, $4, $5, $6)`,
          [description, taskType, targetRepo, rows[0].created_by, JSON.stringify({ ...bundle, infra_retry_count: infraRetries + 1, retry_of: taskId }), rows[0].issue_number],
        );
        console.log(`[agent-watcher] Task ${taskId} transient infra failure (${reason}) — re-queued ${infraRetries + 1}/${MAX_INFRA_RETRIES}`);
      } else if (rows[0]?.status === "running") {
        await query(`UPDATE pipeline.tasks SET status = 'failed', failure_reason = $1, log_url = $2, updated_at = now() WHERE id = $3`, [reason, logUrl, taskId]);
        await query(
          `INSERT INTO pipeline.task_events (task_id, from_status, to_status, metadata) VALUES ($1, 'running', 'failed', $2)`,
          [taskId, JSON.stringify({ error: reason })],
        );
        await commentFailureOnIssue(rows[0].target_repo, rows[0].issue_number, reason);
        queueSlackNotification(rows[0].target_repo, taskId, "failed", `${taskType}: ${reason.substring(0, 200)}`);
        writeEpisodeWithCuration(
          `Task failed on ${targetRepo}: ${taskType}\n\nDescription: ${description}\n\nFailure: ${reason}\n\nOutput:\n${output.slice(-2000)}`,
          "ci", `${targetRepo}/${taskId}`, "agent-watcher", taskId,
        ).catch(() => {});
        console.log(`[agent-watcher] Task ${taskId} failed: ${reason}`);
      }
    }

    // Review verdict (parsed from status.output — Agent has no reviewResult field).
    const reviewResult = phase === "Succeeded" && taskType === "review" ? parseReviewResult(output) : undefined;
    if (reviewResult) {
      const reviewRow = (await query<{ status: string }>(`SELECT status FROM pipeline.tasks WHERE id = $1`, [taskId]))[0];
      if (reviewRow && reviewRow.status !== "running") return;
      const contextBundle = (await query<{ context_bundle: any }>(`SELECT context_bundle FROM pipeline.tasks WHERE id = $1`, [taskId]))[0]?.context_bundle;
      const parentTaskId: string | undefined = contextBundle?.parent_task_id;
      if (!parentTaskId) { console.log(`[agent-watcher] Review ${taskId} has no parent task, skipping`); return; }

      if (reviewResult === "approved") {
        await query(`UPDATE pipeline.tasks SET status = 'completed', updated_at = now() WHERE id = $1`, [parentTaskId]);
        await query(
          `INSERT INTO pipeline.task_events (task_id, from_status, to_status, metadata) VALUES ($1, 'review', 'completed', $2)`,
          [parentTaskId, JSON.stringify({ review_result: "approved", review_task_id: taskId })],
        );
        const { issue_number, target_repo } = await getIssueNumber(parentTaskId);
        if (issue_number) await projectFor(target_repo).then((p) => p.issues.comment(issue_number, "Agent review: **approved**. PR is ready for human merge.")).catch(() => {});
        await query(`UPDATE pipeline.tasks SET status = 'completed', updated_at = now() WHERE id = $1`, [taskId]);
        console.log(`[agent-watcher] Review approved for parent task ${parentTaskId}`);
      } else {
        const parent = (await query<{ review_iteration: number; target_repo: string; target_branch: string; description: string; issue_number: number | null; pr_number: number | null }>(
          `SELECT review_iteration, target_repo, target_branch, description, issue_number, pr_number FROM pipeline.tasks WHERE id = $1`, [parentTaskId],
        ))[0];
        if (!parent) return;
        const iteration = (Number(parent.review_iteration) || 0) + 1;
        await query(`UPDATE pipeline.tasks SET review_iteration = $1, updated_at = now() WHERE id = $2`, [iteration, parentTaskId]);

        if (iteration >= 2) {
          await query(
            `INSERT INTO pipeline.task_events (task_id, from_status, to_status, metadata) VALUES ($1, 'review', 'review', $2)`,
            [parentTaskId, JSON.stringify({ review_result: "needs-human-review", iterations: iteration })],
          );
          if (parent.issue_number) {
            await projectFor(parent.target_repo).then((p) => p.issues.comment(parent.issue_number!, `Agent review: changes requested (iteration ${iteration}/2). Escalating to human review.`)).catch(() => {});
            await projectFor(parent.target_repo).then((p) => p.issues.addLabel(parent.issue_number!, "needs-human-review")).catch(() => {});
          }
          await query(`UPDATE pipeline.tasks SET status = 'completed', updated_at = now() WHERE id = $1`, [taskId]);
          console.log(`[agent-watcher] Review escalated to human for ${parentTaskId} (iteration ${iteration})`);
        } else {
          const comments = parent.pr_number ? await projectFor(parent.target_repo).then((p) => p.pulls.listComments(parent.pr_number!)).catch(() => []) : [];
          const feedback = formatReviewFeedback(comments) || "The agent review requested changes. Read the review comments on the PR and address them.";
          const fixDescription = buildReviewFixDescription({ prNumber: parent.pr_number, iteration });
          const fixTaskId = (await query<{ id: string }>(
            `INSERT INTO pipeline.tasks (description, task_type, target_repo, created_by, context_bundle)
             VALUES ($1, 'implementation', $2, 'review-loop', $3) RETURNING id`,
            [fixDescription, parent.target_repo, JSON.stringify({ branch: parent.target_branch, review_feedback: feedback, parent_task_id: parentTaskId })],
          ))[0].id;
          await (await projectFor(parent.target_repo)).agents.run(fixTaskId, {
            mode: "cluster", taskType: "implementation", description: fixDescription,
            prompt: `Address the following review feedback on PR #${parent.pr_number ?? "?"}. The PR already exists — push fixes to the same branch.\n\nFeedback:\n${feedback}`,
            branch: parent.target_branch || branch, model: "claude-sonnet-4-6", timeoutMinutes: 30,
          });
          if (parent.issue_number) await projectFor(parent.target_repo).then((p) => p.issues.comment(parent.issue_number!, `Agent review: changes requested (iteration ${iteration}/2). Auto-fixing...`)).catch(() => {});
          await query(`UPDATE pipeline.tasks SET status = 'completed', updated_at = now() WHERE id = $1`, [taskId]);
          console.log(`[agent-watcher] Review changes requested, created fix task ${fixTaskId} (iteration ${iteration})`);
        }
      }
    }
  } finally {
    await flushSlackBatch();
  }
}

/** A no-changes Agent we already closed out carries the prUrl sentinel "no-changes". */
export function changedFilesIsZero(status: NonNullable<Agent["status"]>): boolean {
  return status.prUrl === "no-changes";
}
