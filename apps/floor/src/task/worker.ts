/**
 * Core task processing worker.
 *
 * Polls pipeline.tasks for pending work, dispatches to the LLM,
 * and creates branches + PRs with the results.
 */

import { query, getPool } from "../kernel/db.js";
import { generateArtifactCopy } from "../platform/artifact-copy.js";
import { projectFor } from "../composition/project-boot.js";
import { buildPrompt, getTaskTypeConfig } from "../kernel/config.js";
import { agentPrompt } from "../kernel/agent-invocation.js";
import {
  classifyError,
  TaskFailure,
  resolveExecutionImage,
} from "@re-cinq/lore-shared";
import type { PipelineTask } from "@re-cinq/lore-shared";
import { linkifyMarkdown, createDgraphClient, selectStationBackend, isGraphIngestTaskType } from "@re-cinq/lore-shared";
import { handleGraphIngest } from "../spec-trace/graph-ingest-handler.js";
import { slugify, setStatus, insertEvent } from "./task-helpers.js";
import { composeIssueBody } from "./issue-body.js";
import { handleFeatureRequest } from "./handle-feature-request.js";
import { handleClaudeCodeTask } from "./handle-claude-code-task.js";
import { handleFeaturePlanning } from "./handle-feature-planning.js";
import { handleFeatureFinalize } from "./handle-feature-finalize.js";
import { handleFeatureDecompose } from "./handle-feature-decompose.js";
import { handleOnboard } from "./handle-onboard.js";

// Re-export the task handlers so existing import sites (e.g. the onboard
// test importing `handleOnboard` from `./worker.js`) keep working after the
// split.
export { handleFeatureRequest } from "./handle-feature-request.js";
export { handleClaudeCodeTask } from "./handle-claude-code-task.js";
export { handleOnboard } from "./handle-onboard.js";
export { handleGenericOutput } from "./handle-generic-output.js";

// ── Crash recovery ────────────────────────────────────────────────────

/**
 * Reset tasks that have been stuck in running/queued for over 30 minutes
 * back to pending so they can be retried.
 */
export async function recoverStaleTasks(): Promise<number> {
  const stale = await query<{ id: string; task_type: string }>(
    `SELECT id, task_type FROM pipeline.tasks
     WHERE status IN ('running', 'queued')
       AND updated_at < now() - interval '30 minutes'`,
  );

  let recovered = 0;
  for (const row of stale) {
    // Don't reset implementation tasks — they run in ephemeral Job pods
    // managed by the LoreTask CRD. The loretask-watcher handles completion.
    if (row.task_type === "implementation") {
      console.log(
        `[agent] Skipping stale implementation task ${row.id} — managed by LoreTask CRD`,
      );
      continue;
    }
    await setStatus(row.id, "pending");
    await insertEvent(row.id, "running", "pending", {
      reason: "crash-recovery",
    });
    console.log(
      `[agent] Recovered stale task ${row.id} (${row.task_type}) → pending`,
    );
    recovered++;
  }

  return recovered;
}

// ── Worker loop ───────────────────────────────────────────────────────

/**
 * Start the polling worker. Polls every 10 seconds and processes one
 * task at a time.
 */
export async function startWorker(): Promise<void> {
  console.log("[agent] Worker started");
  setInterval(pollOnce, 10_000);
  await pollOnce();
}

async function pollOnce(): Promise<void> {
  // Pick up tasks by priority:
  // - 'immediate': no grace period, executed right away
  // - 'normal': 30-second grace period for local runners to claim first
  const task = await query<PipelineTask>(
    `SELECT * FROM pipeline.tasks
     WHERE status = 'pending'
       AND status != 'running-local'
       AND (
         (priority = 'immediate')
         OR (created_at < now() - interval '30 seconds')
       )
     ORDER BY
       CASE WHEN priority = 'immediate' THEN 0 ELSE 1 END,
       created_at ASC
     LIMIT 1`,
  ).then((rows) => rows[0] ?? null);

  if (!task) return;

  await processTask(task);
}

// ── Task processing ───────────────────────────────────────────────────

async function processTask(task: any): Promise<void> {
  const agentId = `lore-agent-${task.id.substring(0, 8)}`;
  const targetRepo = task.target_repo || "re-cinq/lore";
  const project = await projectFor(targetRepo);

  // Deterministic graph-ingest tasks: zero-LLM, no Issue, no PR. Dispatch before
  // the LLM ladder (Issue creation / approval / Claude Code). The shared
  // runIngestGraph runs in-process against the trace graph. The drift-proof
  // `isGraphIngestTaskType` is OR'd in so a stale/missing `/config/task-types.yaml`
  // (execution_mode goes undefined) can't drop these onto the LLM issue path.
  if (
    getTaskTypeConfig(task.task_type)?.execution_mode === "graph-ingest" ||
    isGraphIngestTaskType(task.task_type)
  ) {
    await handleGraphIngest(task, targetRepo, agentId, { pool: getPool(), project, dgraph: createDgraphClient() });
    return;
  }

  // Feature decomposition (ADR-029): a merged spec → user-story Issues + spec-tasks.
  // Pure LLM analysis + coordinator-side Issue/pipeline writes → always in-process,
  // never a Station (it mutates no repo files).
  if (task.task_type === "feature-decompose") {
    await handleFeatureDecompose(task, targetRepo);
    return;
  }

  // Feature planning + finalize run through the Station (Docker locally, K8s on
  // the cluster; ADR-028), forced below regardless of dark-factory. The explicit
  // LORE_STATION_BACKEND=inprocess escape hatch keeps the lightweight in-process
  // handlers for a dev without Docker/creds.
  const isFeaturePlanningType =
    task.task_type === "feature-planning" || task.task_type === "feature-finalize";
  if (isFeaturePlanningType && selectStationBackend(process.env) === "inprocess") {
    if (task.task_type === "feature-planning") await handleFeaturePlanning(task, targetRepo);
    else await handleFeatureFinalize(task, targetRepo);
    return;
  }

  // Create GitHub Issue on the target repo
  // Skip upfront issue for general tasks — the watcher creates the issue with the result
  let issueNumber: number | null = task.issue_number || null;
  // Dark-factory gate (T019, FR3.2): when dark mode is enabled, defer
  // Issue creation per the repo's `create_issue` setting and the task's
  // approval requirement. `with_issue: true` per-task override forces
  // creation regardless.
  const { shouldCreateIssue } = await import("../dark-factory/dark-factory.js");
  const issueGate = await shouldCreateIssue(task);
  if (!issueNumber && task.task_type !== "general" && !isFeaturePlanningType && issueGate.create) {
    try {
      const taskTypeLabel = task.task_type === "feature-request" ? "spec" : task.task_type;
      const copy = await generateArtifactCopy({
        kind: "issue",
        taskType: task.task_type,
        description: task.description,
        repo: targetRepo,
      });
      const issueBody = linkifyMarkdown(copy.body, { repo: targetRepo, uiUrl: process.env.LORE_UI_URL });
      const issue = await project.issues.create(
        copy.title,
        composeIssueBody(issueBody, task, process.env.LORE_UI_URL),
        ["lore-managed", taskTypeLabel],
      );
      issueNumber = issue.number;
      await query(
        `UPDATE pipeline.tasks SET issue_number = $1, issue_url = $2 WHERE id = $3`,
        [issue.number, issue.url, task.id],
      );
      console.log(`[agent] Created issue #${issue.number} on ${targetRepo}`);
    } catch (err: any) {
      // Non-fatal — proceed without issue if GitHub App lacks permission
    console.warn(`[agent] Could not create issue on ${targetRepo}: ${err.message}`);
    }
  } else if (issueNumber) {
    console.log(`[agent] Using existing issue #${issueNumber} on ${targetRepo} (webhook-dispatched)`);
  } else if (!issueGate.create && task.task_type !== "general") {
    console.log(`[agent] Skipping issue for ${targetRepo} task ${task.id} (dark-factory: ${issueGate.reason})`);
  }

  // Check if this task requires approval
  const { requiresApproval, getApprovalLabel } = await import("../dark-factory/approval.js");
  if (requiresApproval(task.task_type, targetRepo)) {
    await setStatus(task.id, "awaiting_approval");
    await insertEvent(task.id, "pending", "awaiting_approval", { reason: "approval-required" });

    if (issueNumber) {
      await project.issues.comment(issueNumber,
        `This task requires approval before the agent can proceed.\n\nAdd the \`${getApprovalLabel()}\` label to this issue to approve.`);
      await project.issues.addLabel(issueNumber, "awaiting-approval");
    }

    console.log(`[agent] Task ${task.id} requires approval — waiting for label on issue #${issueNumber}`);
    return; // Don't process yet
  }

  // pending → queued
  await setStatus(task.id, "queued", { agent_id: agentId });
  await insertEvent(task.id, "pending", "queued");

  // queued → running
  await setStatus(task.id, "running");
  await insertEvent(task.id, "queued", "running");
  if (issueNumber) {
    await project.issues.comment(issueNumber, `Agent \`${agentId}\` picked up this task.`).catch(() => {});
  }

  try {
    // Fetch per-repo settings for prompt customization
    let repoSettings: any = {};
    try {
      const settingsRows = await query<{ settings: any }>(
        `SELECT settings FROM lore.repos WHERE full_name = $1`, [targetRepo],
      );
      if (settingsRows.length > 0) repoSettings = settingsRows[0].settings || {};
    } catch { /* non-fatal */ }

    // Resolve the agent definition (project → org → yaml) through the single
    // project.agentDefs port seam; fall back to the yaml loader if unavailable.
    const agentDef = await project.agentDefs.resolve(task.task_type).catch(() => null);

    // Build prompt from the resolved definition, with optional per-repo suffix.
    let fullPrompt = agentPrompt(
      agentDef?.prompt,
      task.description,
      buildPrompt(task.task_type, task.description),
    );
    const repoOverrides = repoSettings.task_overrides?.[task.task_type];
    if (repoOverrides?.system_prompt_suffix) {
      fullPrompt += `\n\n${repoOverrides.system_prompt_suffix}`;
    }

    // Determine branch — use existing branch for revision tasks
    const contextBundle = task.context_bundle || {};
    const slug = slugify(task.description);
    const branchName = contextBundle.branch || `lore/${task.task_type}/${slug}-${task.id.substring(0, 8)}`;

    // If this is a revision task, prepend feedback to the description
    if (contextBundle.feedback) {
      task.description = `REVISION FEEDBACK: ${contextBundle.feedback}\n\nOriginal task: ${task.description}`;
    }

    if (!project.repo.isConfigured()) {
      throw new Error("GitHub App not configured — cannot create PR");
    }

    // Resolve model — the resolved agent definition wins, then legacy overrides.
    const model =
      agentDef?.model || repoOverrides?.model || getTaskTypeConfig(task.task_type)?.model || undefined;

    // Dark-factory dispatch (T058 follow-up): when the repo has dark
    // mode enabled AND the task type has a workflow definition, route
    // through the in-agent supervisor instead of the legacy code paths.
    // Limited to JSON-output workflows (gap-fill, runbook); Claude
    // Code-driven types continue via the Job pod path until the
    // entrypoint.sh refactor lands.
    const { isDarkFactoryEligible, processTaskViaSupervisor } = await import(
      "./orchestrator.js"
    );
    const darkFactoryEnabled =
      repoSettings?.dark_factory?.enabled === true;
    if (darkFactoryEnabled && isDarkFactoryEligible(task.task_type)) {
      console.log(
        `[agent] Task ${task.id} routing through dark-factory supervisor (${task.task_type} on ${targetRepo})`,
      );
      const { resolveDarkFactorySettings } = await import(
        "../dark-factory/dark-factory.js"
      );
      const resolvedSettings = resolveDarkFactorySettings(
        repoSettings?.dark_factory,
      );
      const result = await processTaskViaSupervisor({
        task: {
          id: task.id,
          description: task.description,
          task_type: task.task_type,
          target_repo: targetRepo,
        },
        settings: resolvedSettings,
        // Thread the branch through so revision tasks (where
        // contextBundle.branch is preserved) land on the same branch
        // and the supervisor resumes from the prior stage commits.
        branchName,
      });
      switch (result.outcome) {
        case "error":
          throw new Error(result.errorMessage ?? "supervisor failed");
        case "no_changes":
          await setStatus(task.id, "completed");
          await insertEvent(task.id, "running", "completed", {
            reason: "no_changes",
          });
          break;
        case "pr_created":
          // pushAndOpenPr already wrote pr-created status; record the
          // event for completeness.
          await insertEvent(task.id, "running", "pr-created", {
            pr_url: result.prUrl,
            pr_number: result.prNumber,
            via: "dark-factory-supervisor",
          });
          break;
        case "lease_held":
          // Another supervisor (likely a parallel pod) has the branch;
          // back off to queued so the next worker tick retries.
          await setStatus(task.id, "queued", { agent_id: agentId });
          await insertEvent(task.id, "running", "queued", {
            reason: "lease_held",
          });
          break;
        case "iteration_max":
          // Escalation Issue + Slack already fired via
          // onIterationMaxExceeded inside the orchestrator. Mark the
          // task failed with the error message so it surfaces in the UI.
          await setStatus(task.id, "failed", {
            failure_reason: result.errorMessage ?? "iteration_max",
          });
          await insertEvent(task.id, "running", "failed", {
            reason: "iteration_max_exceeded",
          });
          break;
      }
      return;
    }

    if (task.task_type === "onboard") {
      await handleOnboard(task, targetRepo, branchName, model, issueNumber);
    } else if (task.task_type === "feature-request") {
      await handleFeatureRequest(task, targetRepo, branchName, model, issueNumber);
    } else {
      // All other task types run as ephemeral Job pods via LoreTask CRD.
      // For dark-mode repos with a workflow defined for the task type,
      // pass the workflow name through to the LoreTask spec — the
      // controller sets LORE_DARK_FACTORY_WORKFLOW on the pod env, and
      // entrypoint.sh routes to the supervisor CLI instead of the
      // legacy claude --print flow.
      //
      // Gated behind LORE_DARK_FACTORY_CLUSTER_ENABLED until the
      // claude-runner image ships the agent build at /app/dist/. Without
      // the gate, a dark-mode repo firing impl/general/review between
      // this PR landing and the Dockerfile follow-up landing would
      // produce Job pods that fail on the first line of the dark-factory
      // branch in entrypoint.sh.
      const clusterEnabled =
        process.env.LORE_DARK_FACTORY_CLUSTER_ENABLED === "true";
      // feature-planning/finalize always run their workflow in the Station (ADR-028),
      // regardless of the dark-factory cluster gate. Others need both gates on.
      const darkFactoryWorkflow =
        isFeaturePlanningType || (darkFactoryEnabled && clusterEnabled)
          ? task.task_type
          : undefined;

      // Look up the actual default branch when forwarding to a
      // dark-factory pod. Hardcoding "main" 422'd on repos still on
      // master/develop. The pod uses this for `git diff origin/<base>`
      // to detect "did anything actually change?"
      let darkFactoryBaseBranch: string | undefined;
      if (darkFactoryWorkflow) {
        try {
          darkFactoryBaseBranch = await project.repo.defaultBranch();
        } catch (err: any) {
          console.warn(
            `[agent] default-branch lookup failed for ${targetRepo}: ${err.message}`,
          );
        }
      }
      // BYO execution container (ADR-025): resolve the image from the
      // settings hierarchy (default → per-repo → per-task-type). Unset →
      // the platform default, which equals the controller's default, so
      // unconfigured repos see no change.
      const executionImage = resolveExecutionImage(repoSettings, task.task_type);
      await handleClaudeCodeTask(
        task,
        targetRepo,
        branchName,
        model,
        issueNumber,
        repoOverrides,
        darkFactoryWorkflow,
        darkFactoryBaseBranch,
        executionImage,
        agentDef,
      );
    }
  } catch (err: any) {
    const failureReason: string = err.message;
    const meta =
      err instanceof TaskFailure
        ? { error: failureReason, details: err.details }
        : { error: failureReason, ...classifyError(failureReason) };
    await setStatus(task.id, "failed", {
      failure_reason: failureReason,
    });
    await insertEvent(task.id, "running", "failed", meta);
    // Update issue with failure
    if (issueNumber) {
      const hint = "hint" in meta && meta.hint ? ` — ${meta.hint}` : "";
      await project.issues.comment(issueNumber, `Task failed: \`${failureReason}\`${hint}`).catch(() => {});
      await project.issues.addLabel(issueNumber, "lore-failed").catch(() => {});
    }
    console.error(`[agent] Task ${task.id} failed: ${failureReason}`);
  }
}
