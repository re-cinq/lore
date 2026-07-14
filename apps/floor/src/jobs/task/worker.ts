import type { PipelineTask } from "@re-cinq/lore-shared";
import { errorMessage } from "@re-cinq/lore-shared";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
/**
 * Core task processing worker.
 *
 * Polls pipeline.tasks for pending work, dispatches to the LLM,
 * and creates branches + PRs with the results.
 */

import { generateArtifactCopy } from "../lib/artifact-copy.js";
import { projectFor } from "../../composition/project-boot.js";
import { getTaskTypeConfig } from "../../kernel/config.js";
import {
  classifyError,
  TaskFailure,
  resolveExecutionImage,
} from "@re-cinq/lore-shared";
import { linkifyMarkdown, selectStationBackend } from "@re-cinq/lore-shared";
import type { Project } from "@re-cinq/lore-shared";
import { slugify, setStatus, insertEvent } from "./task-helpers.js";
import { taskQueue, settings } from "../../kernel/queues.js";
import type { TaskQueueRepository } from "@re-cinq/lore-shared/project/tasks/task-queue-port.js";
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

// ── Crash recovery ────────────────────────────────────────────────────

/** Dependencies of {@link recoverStaleTasks}; side-effects are injectable so the
 *  recovery policy is testable against the shared InMemory queue with no DB. */
export interface RecoverStaleDeps {
  queue: Pick<TaskQueueRepository, "findRecoverable">;
  setStatus: typeof setStatus;
  insertEvent: typeof insertEvent;
}

/**
 * Reset tasks that have been stuck in running/queued for over 30 minutes
 * back to pending so they can be retried.
 */
export async function recoverStaleTasks(
  deps: RecoverStaleDeps = { queue: taskQueue(), setStatus, insertEvent },
): Promise<number> {
  const stale = await deps.queue.findRecoverable();

  let recovered = 0;

  for (const row of stale) {
    // Don't reset implementation tasks — they run in ephemeral Job pods
    // managed by the LoreTask CRD. The loretask-watcher handles completion.
    if (row.task_type === "implementation") {
      console.log(
        `[floor] Skipping stale implementation task ${row.id} — managed by LoreTask CRD`,
      );
      continue;
    }
    await deps.setStatus(row.id, "pending");
    await deps.insertEvent(row.id, "running", "pending", {
      reason: "crash-recovery",
    });
    console.log(
      `[floor] Recovered stale task ${row.id} (${row.task_type}) → pending`,
    );
    recovered++;
  }

  return recovered;
}

// ── Worker loop ───────────────────────────────────────────────────────

/**
 * Start the polling worker. Polls every 10 seconds and processes one
 * task at a time (a single-flight guard skips ticks while one is running).
 */
export async function startWorker(): Promise<void> {
  console.log("[floor] Worker started");
  setInterval(() => void pollOnce(), 10_000);
  await pollOnce();
}

/** True while a task is processing in this pod — the single-flight latch. */
let processing = false;

/**
 * Claim-and-process at most one task, skipping the tick entirely if a task is
 * already in flight. `processTask` runs a multi-minute in-process LLM loop for
 * onboard/feature/dark-factory tasks, so without this the 10s `setInterval` would
 * stack unbounded concurrent claims — contradicting the "one task at a time"
 * contract. The latch is set before the claim so two overlapping ticks can't both
 * claim. Injectable claim/process keep it unit-testable without a DB.
 */
export async function pollWithGuard<T>(deps: {
  claim: () => Promise<T | null>;
  process: (task: T) => Promise<void>;
}): Promise<void> {
  if (processing) {
    return;
  }
  processing = true;

  try {
    const task = await deps.claim();

    if (!task) {
      return;
    }
    await deps.process(task);
  } finally {
    processing = false;
  }
}

async function pollOnce(): Promise<void> {
  // Pick up the next runnable task: immediate first, otherwise the oldest task
  // past the 30-second grace that lets a local runner claim it first. The claim
  // SQL lives in the shared TaskQueue.
  await pollWithGuard({
    claim: () => taskQueue().claimNextPending(),
    process: processTask,
  });
}

// ── Task processing ───────────────────────────────────────────────────

async function processTask(task: PipelineTask): Promise<void> {
  const agentId = `lore-agent-${task.id.substring(0, 8)}`;
  const targetRepo = task.target_repo || "re-cinq/lore";
  const project = await projectFor(targetRepo);

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
    task.task_type === "feature-planning" ||
    task.task_type === "feature-finalize";

  if (
    isFeaturePlanningType &&
    selectStationBackend(process.env) === "inprocess"
  ) {
    if (task.task_type === "feature-planning") {
      await handleFeaturePlanning(task, targetRepo);
    } else {
      await handleFeatureFinalize(task, targetRepo);
    }

    return;
  }

  const issueNumber = await ensureIssue(
    task,
    targetRepo,
    project,
    isFeaturePlanningType,
  );

  if (await awaitApprovalIfRequired(task, targetRepo, project, issueNumber)) {
    return; // Don't process yet — waiting on the approval label
  }

  // pending → queued
  await setStatus(task.id, "queued", { agent_id: agentId });
  await insertEvent(task.id, "pending", "queued");

  // queued → running
  await setStatus(task.id, "running");
  await insertEvent(task.id, "queued", "running");

  if (issueNumber) {
    await project.issues
      .comment(issueNumber, `Agent \`${agentId}\` picked up this task.`)
      .catch(() => {});
  }

  try {
    // Fetch per-repo settings for prompt customization
    let repoSettings: {
      task_overrides?: Record<
        string,
        { model?: string; system_prompt_suffix?: string }
      >;
      dark_factory?: { enabled?: boolean };
      [key: string]: unknown;
    } = {};

    try {
      repoSettings =
        ((await settings().rawSettings(targetRepo)) as typeof repoSettings) ??
        {};
    } catch {
      /* non-fatal */
    }

    // Resolve the agent definition (project → org → yaml) through the single
    // project.agentDefs port seam; fall back to the yaml loader if unavailable.
    const agentDef = await project.agentDefs
      .resolve(task.task_type)
      .catch(() => null);

    // Build prompt from the resolved definition, with optional per-repo suffix.
    const repoOverrides = repoSettings.task_overrides?.[task.task_type];

    // Determine branch — use existing branch for revision tasks
    const contextBundle = (task.context_bundle || {}) as {
      branch?: string;
      feedback?: string;
    };
    const slug = slugify(task.description);
    const branchName =
      contextBundle.branch ||
      `lore/${task.task_type}/${slug}-${task.id.substring(0, 8)}`;

    // If this is a revision task, prepend feedback to the description
    if (contextBundle.feedback) {
      task.description = `REVISION FEEDBACK: ${contextBundle.feedback}\n\nOriginal task: ${task.description}`;
    }

    enforceTrue(
      project.repo.isConfigured(),
      Error,
      "GitHub App not configured — cannot create PR",
    );

    // Resolve model — the resolved agent definition wins, then legacy overrides.
    const resolvedModel = agentDef?.model || repoOverrides?.model;
    const model =
      resolvedModel || getTaskTypeConfig(task.task_type)?.model || undefined;

    // Read downstream to forward the repo's assembly line name to the Agent CR
    // dispatch (dark-mode repos run the Floor-side graph, one Agent CR per node).
    const darkFactoryEnabled = repoSettings?.dark_factory?.enabled === true;

    if (task.task_type === "onboard") {
      await handleOnboard(task, targetRepo, branchName, model, issueNumber);
    } else if (task.task_type === "feature-request") {
      await handleFeatureRequest(
        task,
        targetRepo,
        branchName,
        model,
        issueNumber,
      );
    } else {
      // All other task types dispatch an Agent CR (agent-cr / ai-agent-subsystem).
      // For dark-mode repos with an assembly line defined for the task type, pass the
      // assembly line name through so AgentCrStationBackend runs the Floor-side graph
      // (one Agent CR per node) instead of a single Agent.
      //
      // feature-planning/finalize always run their assembly line in the Station
      // (ADR-028); other types need the repo's dark-factory mode enabled.
      const darkFactoryAssemblyLine =
        isFeaturePlanningType || darkFactoryEnabled
          ? task.task_type
          : undefined;

      // Look up the actual default branch when forwarding to a
      // dark-factory pod. Hardcoding "main" 422'd on repos still on
      // master/develop. The pod uses this for `git diff origin/<base>`
      // to detect "did anything actually change?"
      let darkFactoryBaseBranch: string | undefined;

      if (darkFactoryAssemblyLine) {
        try {
          darkFactoryBaseBranch = await project.repo.defaultBranch();
        } catch (err) {
          console.warn(
            `[floor] default-branch lookup failed for ${targetRepo}: ${errorMessage(err)}`,
          );
        }
      }
      // BYO execution container (ADR-025): resolve the image from the
      // settings hierarchy (default → per-repo → per-task-type). Unset →
      // the platform default, which equals the controller's default, so
      // unconfigured repos see no change.
      const executionImage = resolveExecutionImage(
        repoSettings as Parameters<typeof resolveExecutionImage>[0],
        task.task_type,
      );

      await handleClaudeCodeTask(
        task,
        targetRepo,
        branchName,
        model,
        issueNumber,
        repoOverrides,
        darkFactoryAssemblyLine,
        darkFactoryBaseBranch,
        executionImage,
        agentDef,
      );
    }
  } catch (err) {
    const failureReason: string = errorMessage(err);
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

      await project.issues
        .comment(issueNumber, `Task failed: \`${failureReason}\`${hint}`)
        .catch(() => {});
      await project.issues.addLabel(issueNumber, "lore-failed").catch(() => {});
    }
    console.error(`[floor] Task ${task.id} failed: ${failureReason}`);
  }
}

/**
 * Resolve the GitHub Issue for a task: an existing one (webhook-dispatched), a
 * newly created one, or none. Dark-factory gate (T019, FR3.2): when dark mode is
 * enabled, Issue creation is deferred per the repo's `create_issue` setting and
 * the task's approval requirement (a `with_issue: true` per-task override forces
 * it). General tasks skip the upfront Issue (the watcher creates it with the
 * result). Returns the resolved issue number (or null).
 */
async function ensureIssue(
  task: PipelineTask,
  targetRepo: string,
  project: Project,
  isFeaturePlanningType: boolean,
): Promise<number | null> {
  let issueNumber: number | null = task.issue_number || null;
  const { shouldCreateIssue } = await import("../dark-factory/dark-factory.js");
  const issueGate = await shouldCreateIssue(task);

  const isIssueEligibleTaskType =
    task.task_type !== "general" && !isFeaturePlanningType;

  if (!issueNumber && isIssueEligibleTaskType && issueGate.create) {
    try {
      const taskTypeLabel =
        task.task_type === "feature-request" ? "spec" : task.task_type;
      const copy = await generateArtifactCopy({
        kind: "issue",
        taskType: task.task_type,
        description: task.description,
        repo: targetRepo,
      });
      const issueBody = linkifyMarkdown(copy.body, {
        repo: targetRepo,
        uiUrl: process.env.LORE_UI_URL,
      });
      const issue = await project.issues.create(
        copy.title,
        composeIssueBody(issueBody, task, process.env.LORE_UI_URL),
        ["lore-managed", taskTypeLabel],
      );

      issueNumber = issue.number;
      await taskQueue().setColumns(task.id, {
        issue_number: issue.number,
        issue_url: issue.url,
      });
      console.log(`[floor] Created issue #${issue.number} on ${targetRepo}`);
    } catch (err) {
      // Non-fatal — proceed without issue if GitHub App lacks permission
      console.warn(
        `[floor] Could not create issue on ${targetRepo}: ${errorMessage(err)}`,
      );
    }
  } else if (issueNumber) {
    console.log(
      `[floor] Using existing issue #${issueNumber} on ${targetRepo} (webhook-dispatched)`,
    );
  } else if (!issueGate.create && task.task_type !== "general") {
    console.log(
      `[floor] Skipping issue for ${targetRepo} task ${task.id} (dark-factory: ${issueGate.reason})`,
    );
  }

  return issueNumber;
}

/**
 * Approval gate (FR3.2): when the repo requires approval for this task type, park
 * the task at `awaiting_approval` and prompt on the Issue. Returns true if the task
 * was parked (the caller must not proceed), false to continue processing.
 */
async function awaitApprovalIfRequired(
  task: PipelineTask,
  targetRepo: string,
  project: Project,
  issueNumber: number | null,
): Promise<boolean> {
  const { requiresApproval, getApprovalLabel } =
    await import("../dark-factory/approval.js");

  if (!requiresApproval(task.task_type, targetRepo)) {
    return false;
  }

  await setStatus(task.id, "awaiting_approval");
  await insertEvent(task.id, "pending", "awaiting_approval", {
    reason: "approval-required",
  });

  if (issueNumber) {
    await project.issues.comment(
      issueNumber,
      `This task requires approval before the agent can proceed.\n\nAdd the \`${getApprovalLabel()}\` label to this issue to approve.`,
    );
    await project.issues.addLabel(issueNumber, "awaiting-approval");
  }
  console.log(
    `[floor] Task ${task.id} requires approval — waiting for label on issue #${issueNumber}`,
  );

  return true;
}
