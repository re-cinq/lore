/**
 * LoreTask watcher job.
 *
 * Polls LoreTask custom resources for completed (Succeeded / Failed) CRs.
 * On success, creates a PR from the branch the ephemeral Job pushed.
 * On failure, updates the pipeline task with the error.
 * Cleans up old CRs after 1 hour.
 */

import { KubeConfig, CustomObjectsApi, CoreV1Api } from "@kubernetes/client-node";
import { projectFor } from "../composition/project-boot.js";
import { query } from "../kernel/db.js";
import { writeEpisode, writeEpisodeWithCuration } from "../memory/episode-writer.js";
import { tryAutoMergeForCompletedTask } from "../merge/auto-merge-trigger.js";
import { isTransientInfraFailure, MAX_INFRA_RETRIES } from "../platform/infra-failure.js";
import { buildReviewFixDescription, formatReviewFeedback } from "@re-cinq/lore-shared";
import { generateArtifactCopy } from "../platform/artifact-copy.js";
import { linkifyMarkdown } from "@re-cinq/lore-shared";

// ── Slack batching ──────────────────────────────────────────────────

interface SlackBatchEntry {
  repo: string;
  taskId: string;
  type: "pr" | "completed" | "failed";
  message: string; // PR URL or failure reason
}

const slackBatch: SlackBatchEntry[] = [];

function queueSlackNotification(repo: string, taskId: string, type: SlackBatchEntry["type"], message: string): void {
  slackBatch.push({ repo, taskId, type, message });
}

async function flushSlackBatch(): Promise<void> {
  if (slackBatch.length === 0) return;

  // Group by repo
  const byRepo = new Map<string, SlackBatchEntry[]>();
  for (const entry of slackBatch) {
    if (!byRepo.has(entry.repo)) byRepo.set(entry.repo, []);
    byRepo.get(entry.repo)!.push(entry);
  }

  for (const [repo, entries] of byRepo) {
    // For single events, post directly (no batching overhead)
    if (entries.length === 1) {
      const e = entries[0];
      const msg = e.type === "pr" ? `PR ready for review: ${e.message}`
        : e.type === "completed" ? `Task completed: ${e.message}`
        : `Task failed: ${e.message}`;
      await notifySlack(e.taskId, repo, msg).catch(() => {});
      continue;
    }

    // Batch: group by type and post a summary
    const prs = entries.filter(e => e.type === "pr");
    const completed = entries.filter(e => e.type === "completed");
    const failed = entries.filter(e => e.type === "failed");

    const parts: string[] = [];
    if (prs.length > 0) {
      parts.push(`*${prs.length} PRs ready for review:*\n${prs.map(e => `• ${e.message}`).join("\n")}`);
    }
    if (completed.length > 0) {
      parts.push(`*${completed.length} tasks completed:*\n${completed.map(e => `• ${e.message}`).join("\n")}`);
    }
    if (failed.length > 0) {
      const firstFailure = failed[0].message;
      if (failed.length === 1) {
        parts.push(`*1 task failed:*\n• ${firstFailure}`);
      } else {
        parts.push(`*${failed.length} tasks failed* (first error: ${firstFailure.substring(0, 100)})`);
      }
    }

    const summary = `*${repo}* — ${entries.length} task updates\n\n${parts.join("\n\n")}`;
    await notifySlack(entries[0].taskId, repo, summary).catch(() => {});
  }

  slackBatch.length = 0;
}

// ── Helpers ─────────────────────────────────────────────────────────

/**
 * Post a message to the Slack channel associated with a task.
 * Checks task's context_bundle first, falls back to repo's mapped channel.
 */
async function notifySlack(taskId: string, repo: string, message: string): Promise<void> {
  const botToken = process.env.LORE_SLACK_BOT_TOKEN;
  if (!botToken) return;

  const bundle = (await query<{ context_bundle: any }>(
    `SELECT context_bundle FROM pipeline.tasks WHERE id = $1`, [taskId],
  ))[0]?.context_bundle;
  let channel = bundle?.slack_channel_id;

  if (!channel) {
    const repoRows = await query<{ settings: any }>(
      `SELECT settings FROM lore.repos WHERE full_name = $1`, [repo],
    );
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
  const rows = await query<{ settings: any }>(
    `SELECT settings FROM lore.repos WHERE full_name = $1`, [repo],
  );
  return rows[0]?.settings?.auto_review === true;
}

async function getIssueNumber(taskId: string): Promise<{ issue_number: number | null; target_repo: string }> {
  const rows = await query<{ issue_number: number | null; target_repo: string }>(
    `SELECT issue_number, target_repo FROM pipeline.tasks WHERE id = $1`,
    [taskId],
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

const GROUP = "lore.re-cinq.com";
const VERSION = "v1alpha1";
const PLURAL = "loretasks";

export async function watchLoreTasks(): Promise<void> {
  const kc = new KubeConfig();
  kc.loadFromCluster();
  const k8sApi = kc.makeApiClient(CustomObjectsApi);
  const namespace = process.env.NAMESPACE || "lore-floor";

  const result = await k8sApi.listNamespacedCustomObject({
    group: GROUP,
    version: VERSION,
    namespace,
    plural: PLURAL,
  });
  const items = (result as any).items || [];

  for (const lt of items) {
    const phase = lt.status?.phase;
    const taskId = lt.spec?.taskId;
    if (!taskId) continue;

    // Logs are now stored in GCS by the controller — no DB persistence needed

    // Skip already-processed tasks (DB-level guard against re-entry)
    if (phase === "Succeeded" || phase === "Failed") {
      const dbRows = await query<{ status: string }>(
        `SELECT status FROM pipeline.tasks WHERE id = $1`, [taskId],
      );
      const dbStatus = dbRows[0]?.status;
      if (dbStatus && !['running', 'queued'].includes(dbStatus)) {
        continue; // Already processed in a previous cycle
      }
    }

    if (phase === "Succeeded" && !lt.status?.prUrl && lt.spec?.taskType !== "review") {
      // Skip PR creation for tasks that produced no changes (e.g. general/research tasks)
      if (lt.status?.changedFiles === 0) {
        // feature-planning posts its GapResult straight to the features API (the
        // result endpoint already transitioned the feature row). Close out the
        // task with no Issue and no PR. See ADR-027.
        if (lt.spec.taskType === "feature-planning") {
          try {
            await query(
              `UPDATE pipeline.tasks SET status = 'completed', updated_at = now() WHERE id = $1`,
              [taskId],
            );
            await query(
              `INSERT INTO pipeline.task_events (task_id, from_status, to_status, metadata) VALUES ($1, 'running', 'completed', $2)`,
              [taskId, JSON.stringify({ feature_planning: true })],
            );
            const current = await k8sApi.getNamespacedCustomObjectStatus({
              group: GROUP, version: VERSION, namespace, plural: PLURAL, name: lt.metadata.name,
            }) as any;
            await k8sApi.replaceNamespacedCustomObjectStatus({
              group: GROUP, version: VERSION, namespace, plural: PLURAL, name: lt.metadata.name,
              body: { ...current, status: { ...current.status, prUrl: "feature-planning" } },
            });
          } catch (err: any) {
            console.error(`[loretask-watcher] feature-planning completion failed for ${taskId}: ${err.message}`);
          }
          console.log(`[loretask-watcher] feature-planning task ${taskId} completed (result posted to API)`);
          continue;
        }
        try {
          let { issue_number, target_repo } = await getIssueNumber(taskId);
          if (!target_repo) target_repo = lt.spec.targetRepo;

          const logUrl = `gs://${process.env.LORE_LOG_BUCKET || "lore-task-logs"}/${lt.spec.targetRepo}/${taskId}/output.log`;
          const output = lt.status?.output || "";

          // Create a GitHub issue with the result as the body (general tasks skip upfront issue creation)
          if (!issue_number) {
            try {
              const copy = await generateArtifactCopy({
                kind: "issue",
                taskType: lt.spec.taskType,
                description: lt.spec.description,
                agentOutput: output,
                repo: target_repo,
              });
              const body = output
                ? `${output.length > 60000 ? output.slice(-60000) + "\n\n…(truncated)" : output}\n\n---\n*Lore-Task: ${taskId}*`
                : `${copy.body}\n\nTask completed (no output). See [logs](${logUrl}).`;
              const issueProject = await projectFor(target_repo);
              const issue = await issueProject.issues.create(
                copy.title,
                body,
                ["lore-managed", lt.spec.taskType],
              );
              issue_number = issue.number;
              await query(
                `UPDATE pipeline.tasks SET issue_number = $1, issue_url = $2 WHERE id = $3`,
                [issue.number, issue.url, taskId],
              );
            } catch { /* best effort */ }
          } else {
            // Issue already exists (e.g. webhook-dispatched) — post result as comment
            const body = output
              ? `## Result\n\n${output.length > 60000 ? output.slice(-60000) + "\n\n…(truncated)" : output}`
              : "Task completed (no code changes). See logs for full output.";
            await projectFor(target_repo).then((p) => p.issues.comment(issue_number!, body)).catch(() => {});
          }

          // Don't close the issue — it's the deliverable for general tasks.
          // User may want to read the result and comment with follow-ups.

          await query(
            `UPDATE pipeline.tasks SET status = 'completed', log_url = $1, updated_at = now() WHERE id = $2`,
            [logUrl, taskId],
          );
          await query(
            `INSERT INTO pipeline.task_events (task_id, from_status, to_status, metadata) VALUES ($1, 'running', 'completed', $2)`,
            [taskId, JSON.stringify({ no_changes: true, issue_number })],
          );
          // Mark the LoreTask CR as handled so the watcher doesn't re-process it
          try {
            const current = await k8sApi.getNamespacedCustomObjectStatus({
              group: GROUP, version: VERSION, namespace, plural: PLURAL, name: lt.metadata.name,
            }) as any;
            await k8sApi.replaceNamespacedCustomObjectStatus({
              group: GROUP, version: VERSION, namespace, plural: PLURAL, name: lt.metadata.name,
              body: { ...current, status: { ...current.status, prUrl: 'no-changes', issueNumber: issue_number } },
            });
          } catch { /* best effort — CR may already be cleaned up */ }

          // Notify Slack
          if (issue_number) {
            const issueUrl = `https://github.com/${target_repo}/issues/${issue_number}`;
            queueSlackNotification(target_repo, taskId, "completed", issueUrl);
          }

          // Auto-capture episode for no-changes completion
          writeEpisode(
            `Task ${lt.spec.taskType} on ${target_repo} completed (no changes)\nDescription: ${lt.spec.description?.substring(0, 500)}\nOutput: ${(output || "").substring(0, 2000)}`,
            "ci",
            `${target_repo}/${taskId}`,
          ).catch(() => {});

          console.log(`[loretask-watcher] Task ${taskId} completed → issue #${issue_number || "none"}`);
        } catch (err: any) {
          console.error(`[loretask-watcher] Failed to complete no-change task ${taskId}: ${err.message}`);
        }
        continue;
      }

      // Create PR from the pushed branch (skip review tasks — they don't push code)
      try {
        const { issue_number, target_repo } = await getIssueNumber(taskId);
        const { prFooter } = await import("@re-cinq/lore-shared");
        const footer = prFooter({ issueNumber: issue_number, taskId });

        const copy = await generateArtifactCopy({
          kind: "pr",
          taskType: lt.spec.taskType,
          description: lt.spec.description,
          agentOutput: lt.status?.output,
          changedFiles: lt.status.changedFiles,
          repo: lt.spec.targetRepo,
        });

        const body = linkifyMarkdown(copy.body, {
          repo: lt.spec.targetRepo,
          branch: lt.spec.branch,
          uiUrl: process.env.LORE_UI_URL,
        });
        const prProject = await projectFor(lt.spec.targetRepo);
        const pr = await prProject.pulls.open(lt.spec.branch, copy.title, `${body}${footer}`);

        // Update pipeline.tasks
        await query(
          `UPDATE pipeline.tasks SET status = 'pr-created', pr_url = $1, pr_number = $2, target_branch = $3, updated_at = now() WHERE id = $4`,
          [pr.url, pr.number, lt.spec.branch, taskId],
        );

        // After updating pipeline.tasks with pr_url, also set log_url
        const logUrl = `gs://${process.env.LORE_LOG_BUCKET || "lore-task-logs"}/${lt.spec.targetRepo}/${taskId}/output.log`;
        await query(
          `UPDATE pipeline.tasks SET log_url = $1 WHERE id = $2`,
          [logUrl, taskId],
        );

        await query(
          `INSERT INTO pipeline.task_events (task_id, from_status, to_status, metadata) VALUES ($1, 'running', 'pr-created', $2)`,
          [taskId, JSON.stringify({ pr_url: pr.url })],
        );

        // Link PR to GitHub Issue and close it
        await linkPrToIssue(target_repo, issue_number, pr.url);

        // Update LoreTask status with PR URL
        const current = await k8sApi.getNamespacedCustomObjectStatus({
          group: GROUP, version: VERSION, namespace, plural: PLURAL, name: lt.metadata.name,
        }) as any;
        await k8sApi.replaceNamespacedCustomObjectStatus({
          group: GROUP, version: VERSION, namespace, plural: PLURAL, name: lt.metadata.name,
          body: { ...current, status: { ...current.status, prUrl: pr.url, prNumber: pr.number } },
        });

        // feature-finalize: link the PR back to the feature row so the Features
        // tab flips to pr-open and shows the PR + spec path (ADR-027).
        if (lt.spec.taskType === "feature-finalize") {
          try {
            const rows = await query<{ context_bundle: any }>(
              `SELECT context_bundle FROM pipeline.tasks WHERE id = $1`,
              [taskId],
            );
            const featureId = rows[0]?.context_bundle?.feature_id;
            const slug = rows[0]?.context_bundle?.slug;
            if (featureId) {
              await prProject.features.transitionStatus(featureId, "pr-open", {
                spec_pr_url: pr.url,
                spec_pr_number: pr.number,
                ...(slug ? { spec_path: `specs/${slug}/spec.md` } : {}),
              });
            }
          } catch (err: any) {
            console.warn(`[loretask-watcher] feature-finalize link failed for ${taskId}: ${err.message}`);
          }
        }

        console.log(`[loretask-watcher] Task ${taskId} → PR ${pr.url}`);

        // Post PR link to Slack
        queueSlackNotification(lt.spec.targetRepo, taskId, "pr", pr.url);

        // Auto-capture episode for successful PR creation
        writeEpisodeWithCuration(
          `Task ${lt.spec.taskType} on ${lt.spec.targetRepo}: created PR ${pr.url}\nChanged files: ${lt.status.changedFiles || "unknown"}\nDescription: ${lt.spec.description?.substring(0, 500)}`,
          "ci",
          `${lt.spec.targetRepo}/${taskId}`,
          "loretask-watcher",
          taskId,
        ).catch(() => {});

        // Cluster-path auto-merge hook (closes the gap left by PR #310,
        // documented in runbooks/dark-factory-rollback.md). The runner-cli
        // intentionally does NOT call evaluateAndMerge from inside the
        // pod because the watcher owns PR creation — firing it from the
        // pod would race this code path. Now that the PR exists and
        // pipeline.tasks has been updated with pr_number, the auto-merge
        // policy can run here. tryAutoMergeForCompletedTask short-circuits
        // when dark mode is off, so this is safe to call for every task.
        // Fire-and-forget: a flaky GitHub call must never block PR
        // creation or downstream auto-review wiring. The first call
        // typically defers (CI hasn't started — `check_runs` is
        // empty); the webhook-driven re-trigger
        // (mcp-server `check_run`/`check_suite` → agent
        // `/api/trigger/auto-merge`) re-fires once CI completes.
        tryAutoMergeForCompletedTask({ taskId }).catch((err) =>
          console.warn(
            `[loretask-watcher] auto-merge trigger failed for task ${taskId}:`,
            (err as Error).message,
          ),
        );

        // Trigger auto-review if enabled for this repo
        if (await shouldAutoReview(lt.spec.targetRepo)) {
          const reviewTaskResult = await query<{ id: string }>(
            `INSERT INTO pipeline.tasks (description, task_type, target_repo, created_by, context_bundle)
             VALUES ($1, $2, $3, $4, $5) RETURNING id`,
            [
              `Review PR #${pr.number} on ${lt.spec.targetRepo}`,
              'review',
              lt.spec.targetRepo,
              'loretask-watcher',
              JSON.stringify({ pr_number: pr.number, branch: lt.spec.branch, parent_task_id: taskId }),
            ],
          );
          const reviewTaskId = reviewTaskResult[0].id;

          // Create review LoreTask CR
          const reviewProject = await projectFor(lt.spec.targetRepo);
          await reviewProject.agents.run(reviewTaskId, {
            mode: "cluster",
            taskType: "review",
            description: `Review PR #${pr.number} on ${lt.spec.targetRepo}`,
            prompt: `Review PR #${pr.number} on this branch. Read the spec in specs/ for the feature requirements. Check all changes against CLAUDE.md conventions and ADRs in adrs/. Post specific review comments on the PR using 'gh pr review'. Then output exactly one of:\n- REVIEW_RESULT:APPROVED\n- REVIEW_RESULT:CHANGES_REQUESTED:<specific actionable feedback>`,
            branch: lt.spec.branch,
            prNumber: pr.number,
            model: "claude-sonnet-4-6",
            timeoutMinutes: 10,
          });

          // Update implementation task to review status
          await query(
            `UPDATE pipeline.tasks SET status = 'review', updated_at = now() WHERE id = $1`,
            [taskId],
          );
          await query(
            `INSERT INTO pipeline.task_events (task_id, from_status, to_status, metadata) VALUES ($1, 'pr-created', 'review', $2)`,
            [taskId, JSON.stringify({ review_task_id: reviewTaskId, auto_review: true })],
          );

          console.log(`[loretask-watcher] Auto-review: created review task ${reviewTaskId} for PR #${pr.number}`);
        }
      } catch (err: any) {
        const msg = String(err?.message || err);
        console.error(`[loretask-watcher] Failed to create PR for ${taskId}: ${msg}`);

        // Detect terminal failure modes. Without this the pipeline.tasks
        // row stays in `running`, the watcher re-tries createPR on every
        // tick, and the task loops forever (see the 44ca04b0 zoho-CRM
        // case stuck since 2026-04-14).
        const isNoCommits = /No commits between/i.test(msg);
        const isPrAlreadyExists = /A pull request already exists/i.test(msg);
        const isTerminal = isNoCommits || isPrAlreadyExists;

        if (isTerminal) {
          const reason = isNoCommits ? "no-code-changes" : "pr-already-exists";
          await query(
            `UPDATE pipeline.tasks
             SET status = 'needs-human-help',
                 failure_reason = $2,
                 updated_at = now()
             WHERE id = $1`,
            [taskId, `createPR failed: ${reason}. ${msg.substring(0, 300)}`],
          ).catch(() => {});
          await query(
            `INSERT INTO pipeline.task_events (task_id, from_status, to_status, metadata)
             VALUES ($1, 'running', 'needs-human-help', $2)`,
            [taskId, JSON.stringify({ reason, detected_by: "loretask-watcher", error: msg.substring(0, 500) })],
          ).catch(() => {});
          // Stop the LoreTask CR from being re-processed
          try {
            await k8sApi.deleteNamespacedCustomObject({
              group: GROUP, version: VERSION, namespace, plural: PLURAL, name: lt.metadata.name,
            });
          } catch { /* already gone */ }
          console.log(`[loretask-watcher] Marked ${taskId} needs-human-help (${reason}) and deleted LoreTask CR`);
        }
      }
    }

    if (phase === "Failed" && lt.status?.failureReason) {
      // Update pipeline.tasks with failure
      const rows = await query<{ status: string; issue_number: number | null; target_repo: string; created_by: string; context_bundle: Record<string, unknown> | null }>(
        `SELECT status, issue_number, target_repo, created_by, context_bundle FROM pipeline.tasks WHERE id = $1`, [taskId],
      );
      const reason = lt.status.failureReason;
      const bundle = rows[0]?.context_bundle ?? {};
      const infraRetries = Number(bundle.infra_retry_count ?? 0);

      if (rows[0]?.status === "running" && isTransientInfraFailure(reason) && infraRetries < MAX_INFRA_RETRIES) {
        // Transient infrastructure failure (e.g. BackoffLimitExceeded from a bad
        // deploy) — re-queue a fresh attempt instead of a terminal lore-failed.
        // Bounded so a genuinely broken pod can't loop forever. The new task
        // keeps the same issue so retries don't spawn duplicate issues.
        const logUrl = `gs://${process.env.LORE_LOG_BUCKET || "lore-task-logs"}/${lt.spec.targetRepo}/${taskId}/output.log`;
        await query(
          `UPDATE pipeline.tasks SET status = 'failed', failure_reason = $1, log_url = $2, updated_at = now() WHERE id = $3`,
          [reason, logUrl, taskId],
        );
        await query(
          `INSERT INTO pipeline.task_events (task_id, from_status, to_status, metadata) VALUES ($1, 'running', 'failed', $2)`,
          [taskId, JSON.stringify({ error: reason, transient_infra: true, infra_retry: infraRetries + 1 })],
        );
        await query(
          `INSERT INTO pipeline.tasks (description, task_type, status, target_repo, created_by, context_bundle, issue_number)
           VALUES ($1, $2, 'pending', $3, $4, $5, $6)`,
          [
            lt.spec.description,
            lt.spec.taskType,
            lt.spec.targetRepo,
            rows[0].created_by,
            JSON.stringify({ ...bundle, infra_retry_count: infraRetries + 1, retry_of: taskId }),
            rows[0].issue_number,
          ],
        );
        console.log(
          `[loretask-watcher] Task ${taskId} transient infra failure (${reason}) — re-queued attempt ${infraRetries + 1}/${MAX_INFRA_RETRIES}`,
        );
      } else if (rows[0]?.status === "running") {
        await query(
          `UPDATE pipeline.tasks SET status = 'failed', failure_reason = $1, updated_at = now() WHERE id = $2`,
          [lt.status.failureReason, taskId],
        );

        // Set log_url for failed tasks so logs are still accessible
        const logUrl = `gs://${process.env.LORE_LOG_BUCKET || "lore-task-logs"}/${lt.spec.targetRepo}/${taskId}/output.log`;
        await query(
          `UPDATE pipeline.tasks SET log_url = $1 WHERE id = $2`,
          [logUrl, taskId],
        );

        await query(
          `INSERT INTO pipeline.task_events (task_id, from_status, to_status, metadata) VALUES ($1, 'running', 'failed', $2)`,
          [taskId, JSON.stringify({ error: lt.status.failureReason })],
        );
        await commentFailureOnIssue(rows[0].target_repo, rows[0].issue_number, lt.status.failureReason);

        // Notify Slack on failure
        queueSlackNotification(rows[0].target_repo, taskId, "failed", `${lt.spec.taskType}: ${lt.status.failureReason?.substring(0, 200)}`);

        // Auto-capture failure as episode with curation (lesson extraction)
        const failureContent = `Task failed on ${lt.spec.targetRepo}: ${lt.spec.taskType}\n\nDescription: ${lt.spec.description}\n\nFailure: ${lt.status.failureReason}\n\nOutput:\n${(lt.status?.output || '').slice(-2000)}`;
        writeEpisodeWithCuration(
          failureContent, "ci", `${lt.spec.targetRepo}/${taskId}`, "loretask-watcher", taskId,
        ).catch(() => {});

        console.log(`[loretask-watcher] Task ${taskId} failed: ${lt.status.failureReason}`);
      }
    }

    // Handle completed review tasks (only if this review task hasn't been processed yet)
    if (phase === "Succeeded" && lt.spec.taskType === "review" && lt.status?.reviewResult) {
      // Skip if this review task is already in a terminal state in the DB
      const reviewTaskRow = (await query<{ status: string }>(`SELECT status FROM pipeline.tasks WHERE id = $1`, [taskId]))[0];
      if (reviewTaskRow && reviewTaskRow.status !== "running") {
        continue; // Already processed
      }
      const contextBundle = (await query<{ context_bundle: any }>(
        `SELECT context_bundle FROM pipeline.tasks WHERE id = $1`, [taskId],
      ))[0]?.context_bundle;
      const parentTaskId: string | undefined =
        lt.status?.parentTaskId || contextBundle?.parent_task_id;

      if (!parentTaskId) {
        console.log(`[loretask-watcher] Review ${taskId} has no parent task, skipping`);
        continue;
      }

      if (lt.status.reviewResult === "approved") {
        await query(
          `UPDATE pipeline.tasks SET status = 'completed', updated_at = now() WHERE id = $1`,
          [parentTaskId],
        );
        await query(
          `INSERT INTO pipeline.task_events (task_id, from_status, to_status, metadata) VALUES ($1, $2, $3, $4)`,
          [parentTaskId, 'review', 'completed', JSON.stringify({ review_result: 'approved', review_task_id: taskId })],
        );
        // Comment on issue
        const { issue_number, target_repo } = await getIssueNumber(parentTaskId);
        if (issue_number) {
          await projectFor(target_repo).then((p) => p.issues.comment(issue_number, "Agent review: **approved**. PR is ready for human merge.")).catch(() => {});
        }
        // Mark the review task itself as completed
        await query(`UPDATE pipeline.tasks SET status = 'completed', updated_at = now() WHERE id = $1`, [taskId]);
        console.log(`[loretask-watcher] Review approved for parent task ${parentTaskId}`);
      } else {
        // Changes requested — check iteration count
        const parentRows = await query<{
          review_iteration: number;
          target_repo: string;
          target_branch: string;
          description: string;
          issue_number: number | null;
          pr_number: number | null;
        }>(
          `SELECT review_iteration, target_repo, target_branch, description, issue_number, pr_number FROM pipeline.tasks WHERE id = $1`,
          [parentTaskId],
        );
        const parent = parentRows[0];
        if (!parent) continue;

        const iteration = (Number(parent.review_iteration) || 0) + 1;
        await query(`UPDATE pipeline.tasks SET review_iteration = $1, updated_at = now() WHERE id = $2`, [iteration, parentTaskId]);

        if (iteration >= 2) {
          // Escalate to human
          await query(
            `UPDATE pipeline.tasks SET status = 'review', updated_at = now() WHERE id = $1`,
            [parentTaskId],
          );
          await query(
            `INSERT INTO pipeline.task_events (task_id, from_status, to_status, metadata) VALUES ($1, $2, $3, $4)`,
            [parentTaskId, 'review', 'review', JSON.stringify({ review_result: 'needs-human-review', iterations: iteration })],
          );
          if (parent.issue_number) {
            await projectFor(parent.target_repo).then((p) => p.issues.comment(parent.issue_number!, `Agent review: changes requested (iteration ${iteration}/2). Escalating to human review.`)).catch(() => {});
            await projectFor(parent.target_repo).then((p) => p.issues.addLabel(parent.issue_number!, "needs-human-review")).catch(() => {});
          }
          // Mark the review task itself as completed so the watcher stops
          // re-processing it every tick. Without this line the review task
          // stays `running`, the watcher revisits it on every poll, and
          // each visit re-increments review_iteration + re-posts the
          // "escalated" comment (iteration 5680+ per 2026-04-19 incident).
          await query(`UPDATE pipeline.tasks SET status = 'completed', updated_at = now() WHERE id = $1`, [taskId]);
          console.log(`[loretask-watcher] Review escalated to human for ${parentTaskId} (iteration ${iteration})`);
        } else {
          // Create new implementation task with the actual reviewer comments
          // (not the raw runner log) on the same branch.
          const comments = parent.pr_number
            ? await projectFor(parent.target_repo).then((p) => p.pulls.listComments(parent.pr_number!)).catch(() => [])
            : [];
          const feedback =
            formatReviewFeedback(comments) ||
            "The agent review requested changes. Read the review comments on the PR and address them.";
          const description = buildReviewFixDescription({ prNumber: parent.pr_number, iteration });
          const fixTaskResult = await query<{ id: string }>(
            `INSERT INTO pipeline.tasks (description, task_type, target_repo, created_by, context_bundle)
             VALUES ($1, $2, $3, $4, $5) RETURNING id`,
            [
              description,
              'implementation',
              parent.target_repo,
              'review-loop',
              JSON.stringify({ branch: parent.target_branch, review_feedback: feedback, parent_task_id: parentTaskId }),
            ],
          );
          const fixTaskId = fixTaskResult[0].id;

          // Create implementation LoreTask CR on the same branch
          const fixProject = await projectFor(parent.target_repo);
          await fixProject.agents.run(fixTaskId, {
            mode: "cluster",
            taskType: "implementation",
            description,
            prompt: `Address the following review feedback on PR #${parent.pr_number ?? "?"}. The PR already exists — push fixes to the same branch.\n\nFeedback:\n${feedback}`,
            branch: parent.target_branch || lt.spec.branch,
            model: "claude-sonnet-4-6",
            timeoutMinutes: 30,
          });

          if (parent.issue_number) {
            await projectFor(parent.target_repo).then((p) => p.issues.comment(parent.issue_number!, `Agent review: changes requested (iteration ${iteration}/2). Auto-fixing...`)).catch(() => {});
          }
          // Mark this review task completed — it did its job (CHANGES_REQUESTED
          // captured, fix task created). Otherwise the watcher re-processes
          // it every tick and spawns duplicate fix tasks on the same branch.
          await query(`UPDATE pipeline.tasks SET status = 'completed', updated_at = now() WHERE id = $1`, [taskId]);
          console.log(`[loretask-watcher] Review changes requested, created fix task ${fixTaskId} (iteration ${iteration})`);
        }
      }
    }

    // Clean up old completed LoreTasks (> 1 hour old with PR, no changes, or failed)
    if ((phase === "Succeeded" && (lt.status?.prUrl || lt.status?.changedFiles === 0)) || (phase === "Failed")) {
      const completedAt = lt.status?.completedAt ? new Date(lt.status.completedAt) : null;
      if (completedAt && Date.now() - completedAt.getTime() > 60 * 60 * 1000) {
        const taskIdShort = taskId.substring(0, 8);
        try {
          await k8sApi.deleteNamespacedCustomObject({
            group: GROUP, version: VERSION, namespace, plural: PLURAL, name: lt.metadata.name,
          });
          console.log(`[loretask-watcher] Cleaned up LoreTask ${lt.metadata.name}`);
        } catch { /* best effort */ }
        // Clean up orphaned token secret
        try {
          const coreApi = kc.makeApiClient(CoreV1Api);
          await coreApi.deleteNamespacedSecret({ name: `loretask-github-token-${taskIdShort}`, namespace });
        } catch { /* already gone or never created */ }
      }
    }
  }

  // Flush batched Slack notifications as a single summary per repo
  await flushSlackBatch();
}

/**
 * Job wrapper for the scheduler. Returns a summary string.
 */
export async function loretaskWatcherJob(): Promise<string> {
  await watchLoreTasks();
  return "LoreTask watcher completed";
}
