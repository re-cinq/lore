import type { PipelineTask } from "@re-cinq/lore-shared";
import { taskPageUrl } from "../watcher/agent-watcher-logic.js";
import { errorMessage } from "@re-cinq/lore-shared";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
/** Core task processing worker: polls pipeline.tasks, dispatches to the LLM, creates branches + PRs. */

import { generateArtifactCopy } from "../lib/artifact-copy.js";
import { projectFor } from "../../composition/project-boot.js";
import { getTaskTypeConfig } from "../../kernel/config.js";
import {
  classifyError,
  TaskFailure,
  resolveExecutionImage,
} from "@re-cinq/lore-shared";
import { linkifyMarkdown } from "@re-cinq/lore-shared";
import type { Project } from "@re-cinq/lore-shared";
import { slugify, setStatus, insertEvent } from "./task-helpers.js";
import { pipeline, settings } from "../../kernel/queues.js";
import type { TaskQueueRepository } from "@re-cinq/lore-shared/project/tasks/task-queue-port.js";
import { composeIssueBody } from "./issue-body.js";
import { handleFeatureRequest } from "./handle-feature-request.js";
import { handleClaudeCodeTask } from "./handle-claude-code-task.js";
import { handleOnboard } from "./handle-onboard.js";

// Re-export so existing import sites (e.g. the onboard test) keep working after the split.
export { handleFeatureRequest } from "./handle-feature-request.js";
export { handleClaudeCodeTask } from "./handle-claude-code-task.js";
export { handleOnboard } from "./handle-onboard.js";

/** Feature lifecycle types: each runs its own assembly line regardless of dark-factory and opens no per-task Issue (decompose files its own per story). */
export function isFeatureLifecycleType(taskType: string): boolean {
  return taskType === "feature-planning" || taskType === "feature-decompose";
}

// ── Crash recovery ────────────────────────────────────────────────────

/** Dependencies of {@link recoverStaleTasks}, injectable so the policy is testable against the InMemory queue with no DB. */
export interface RecoverStaleDeps {
  queue: Pick<TaskQueueRepository, "findRecoverable">;
  setStatus: typeof setStatus;
  insertEvent: typeof insertEvent;
  /** True while an assembly line for this task is still queued or running. */
  hasOpenLine: (taskId: string) => Promise<boolean>;
}

/** Resets tasks stuck in running/queued 30+ min back to pending; the open-line check (not just age) prevents re-dispatching a task parked on a human for days on every boot. */
export async function recoverStaleTasks(
  deps: RecoverStaleDeps = {
    queue: pipeline().taskQueue,
    setStatus,
    insertEvent,
    hasOpenLine: async (taskId) =>
      (await pipeline().assemblyRuns.listForTask(taskId)).some(
        (line) => line.status === "running" || line.status === "queued",
      ),
  },
): Promise<number> {
  const stale = await deps.queue.findRecoverable();

  let recovered = 0;

  for (const row of stale) {
    // Not stale — its line is still walking (or parked on a person).
    if (await deps.hasOpenLine(row.id)) {
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

/** Polls every 10 seconds and processes one task at a time (a single-flight guard skips ticks while one is running). */
export async function startWorker(): Promise<void> {
  console.log("[floor] Worker started");
  setInterval(() => void pollOnce(), 10_000);
  await pollOnce();
}

/** True while a task is processing in this pod — the single-flight latch. */
let processing = false;

/** Claim-and-process at most one task, skipping the tick if one is in flight — without this the 10s `setInterval` would stack unbounded concurrent claims. */
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
  // Immediate task first, else oldest task past the 30s grace that lets a local runner claim it first.
  await pollWithGuard({
    claim: () => pipeline().taskQueue.claimNextPending(),
    process: processTask,
  });
}

// ── Task processing ───────────────────────────────────────────────────

/** Which handler a task type goes to. Exported because the routing IS the decision worth testing — a test that re-implements it can drift from the thing it claims to check. */
export type TaskHandler =
  "handleOnboard" | "handleFeatureRequest" | "handleClaudeCodeTask";

export function routeTask(taskType: string): TaskHandler {
  if (taskType === "onboard") {
    return "handleOnboard";
  }

  return taskType === "feature-request"
    ? "handleFeatureRequest"
    : "handleClaudeCodeTask";
}

interface DispatchInput {
  task: PipelineTask;
  targetRepo: string;
  branchName: string;
  model: string | undefined;
  issueNumber: number | null;
  project: Awaited<ReturnType<typeof projectFor>>;
  repoSettings: Record<string, unknown>;
  repoOverrides: Record<string, unknown> | undefined;
  agentDef: Awaited<ReturnType<Project["agentDefs"]["resolve"]>> | null;
  darkFactoryEnabled: boolean;
  isFeaturePlanningType: boolean;
}

async function dispatchByTaskType(
  handler: TaskHandler,
  input: DispatchInput,
): Promise<void> {
  const { task, targetRepo, branchName, model, issueNumber } = input;

  if (handler === "handleOnboard") {
    return handleOnboard({ task, targetRepo, branchName, model, issueNumber });
  }

  if (handler === "handleFeatureRequest") {
    return handleFeatureRequest({
      task,
      targetRepo,
      branchName,
      model,
      issueNumber,
    });
  }

  return dispatchAgentCr(input);
}

/** Dark-mode repos and feature-planning/finalize run the Floor-side graph, one Agent CR per node (ADR-028). */
async function dispatchAgentCr(input: DispatchInput): Promise<void> {
  const { task, targetRepo, project, repoSettings } = input;
  const assemblyLine =
    input.isFeaturePlanningType || input.darkFactoryEnabled
      ? task.task_type
      : undefined;
  // The real default branch, never a hardcoded "main": that 422'd on master/develop repos.
  const baseBranch = await lookupDarkFactoryBaseBranch(
    project,
    targetRepo,
    assemblyLine,
  );

  await handleClaudeCodeTask({
    task,
    targetRepo,
    branchName: input.branchName,
    model: input.model,
    repoOverrides: input.repoOverrides,
    ...(assemblyLine ? { darkFactory: { assemblyLine, baseBranch } } : {}),
    // BYO execution container (ADR-025): default → per-repo → per-task-type; unset means the controller's default.
    image: resolveExecutionImage(
      repoSettings as Parameters<typeof resolveExecutionImage>[0],
      task.task_type,
    ),
    agentDef: input.agentDef,
  });
}

/** pending → queued → running, then tell the Issue who picked it up. The comment is best-effort: a task runs whether or not its Issue can be written to. */
async function claimTask(
  task: PipelineTask,
  agentId: string,
  project: Awaited<ReturnType<typeof projectFor>>,
  issueNumber: number | null,
): Promise<void> {
  await setStatus(task.id, "queued", { agent_id: agentId });
  await insertEvent(task.id, "pending", "queued");
  await setStatus(task.id, "running");
  await insertEvent(task.id, "queued", "running");

  if (!issueNumber) {
    return;
  }
  const pipelineUrl = taskPageUrl(task.id, process.env.LORE_UI_URL);

  await project.issues
    .comment(
      issueNumber,
      `Agent \`${agentId}\` picked up this task.` +
        (pipelineUrl ? ` Follow it on the pipeline: ${pipelineUrl}` : ""),
    )
    .catch(() => {});
}

interface RepoSettings {
  task_overrides?: Record<
    string,
    { model?: string; system_prompt_suffix?: string }
  >;
  dark_factory?: { enabled?: boolean };
  [key: string]: unknown;
}

/** Unreadable settings are not a reason to fail the task; the plan falls back to the defaults. */
async function readRepoSettings(targetRepo: string): Promise<RepoSettings> {
  try {
    return ((await settings().rawSettings(targetRepo)) as RepoSettings) ?? {};
  } catch {
    return {};
  }
}

/** How this task runs: which branch, which model, which agent definition, and whether the repo puts it through the Floor-side graph. */
async function resolveTaskPlan(
  task: PipelineTask,
  targetRepo: string,
  project: Awaited<ReturnType<typeof projectFor>>,
) {
  const repoSettings = await readRepoSettings(targetRepo);
  // Resolved project → org → yaml through the one project.agentDefs seam.
  const agentDef = await project.agentDefs
    .resolve(task.task_type)
    .catch(() => null);
  const repoOverrides = repoSettings.task_overrides?.[task.task_type];
  const contextBundle = (task.context_bundle || {}) as {
    branch?: string;
    feedback?: string;
  };

  // A revision runs on the branch it is revising, and says what it is revising.
  if (contextBundle.feedback) {
    task.description = `REVISION FEEDBACK: ${contextBundle.feedback}\n\nOriginal task: ${task.description}`;
  }

  return {
    repoSettings,
    repoOverrides,
    agentDef,
    branchName:
      contextBundle.branch ||
      `lore/${task.task_type}/${slugify(task.description)}-${task.id.substring(0, 8)}`,
    // The resolved agent definition wins, then legacy per-repo overrides.
    model:
      agentDef?.model ||
      repoOverrides?.model ||
      getTaskTypeConfig(task.task_type)?.model,
    darkFactoryEnabled: repoSettings?.dark_factory?.enabled === true,
  };
}

async function processTask(task: PipelineTask): Promise<void> {
  const agentId = `lore-agent-${task.id.substring(0, 8)}`;
  const targetRepo = task.target_repo || "re-cinq/lore";
  const project = await projectFor(targetRepo);

  // Feature lifecycle runs through the Station (ADR-028), forced below regardless of dark-factory; also gates Issue creation (decompose files its own).
  const isFeaturePlanningType = isFeatureLifecycleType(task.task_type);

  const issueNumber = await ensureIssue(
    task,
    targetRepo,
    project,
    isFeaturePlanningType,
  );

  if (await awaitApprovalIfRequired(task, targetRepo, project, issueNumber)) {
    return; // Don't process yet — waiting on the approval label
  }

  await claimTask(task, agentId, project, issueNumber);

  try {
    const plan = await resolveTaskPlan(task, targetRepo, project);

    enforceTrue(
      project.repo.isConfigured(),
      Error,
      "GitHub App not configured — cannot create PR",
    );
    await dispatchByTaskType(routeTask(task.task_type), {
      task,
      targetRepo,
      issueNumber,
      project,
      isFeaturePlanningType,
      ...plan,
    });
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

async function lookupDarkFactoryBaseBranch(
  project: Project,
  targetRepo: string,
  darkFactoryAssemblyLine: string | undefined,
): Promise<string | undefined> {
  if (!darkFactoryAssemblyLine) {
    return undefined;
  }

  try {
    return await project.repo.defaultBranch();
  } catch (err) {
    console.warn(
      `[floor] default-branch lookup failed for ${targetRepo}: ${errorMessage(err)}`,
    );

    return undefined;
  }
}

/** Existing, new, or no Issue: dark mode defers creation per `create_issue` unless `with_issue: true` forces it (FR3.2). */
async function ensureIssue(
  task: PipelineTask,
  targetRepo: string,
  project: Project,
  isFeaturePlanningType: boolean,
): Promise<number | null> {
  const existing = task.issue_number || null;

  if (existing) {
    console.log(
      `[floor] Using existing issue #${existing} on ${targetRepo} (webhook-dispatched)`,
    );

    return existing;
  }
  const { shouldCreateIssue } = await import("../dark-factory/dark-factory.js");
  const gate = await shouldCreateIssue(task);
  // A general task never files one, and a feature-planning line files its own.
  const eligible = task.task_type !== "general" && !isFeaturePlanningType;

  // A general task files none by design, so its skip is not worth reporting.
  const skipIsNoteworthy = task.task_type !== "general";

  if ((!eligible || !gate.create) && skipIsNoteworthy) {
    console.log(
      `[floor] Skipping issue for ${targetRepo} task ${task.id} (dark-factory: ${gate.reason})`,
    );
  }

  if (!eligible || !gate.create) {
    return null;
  }

  return createTaskIssue(task, targetRepo, project);
}

/** File the Issue this task reports against. Non-fatal: a GitHub App without permission costs the task its Issue, not its run. */
async function createTaskIssue(
  task: PipelineTask,
  targetRepo: string,
  project: Project,
): Promise<number | null> {
  try {
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
      [
        "lore-managed",
        task.task_type === "feature-request" ? "spec" : task.task_type,
      ],
    );

    await pipeline().taskQueue.setColumns(task.id, {
      issue_number: issue.number,
      issue_url: issue.url,
    });
    console.log(`[floor] Created issue #${issue.number} on ${targetRepo}`);

    return issue.number;
  } catch (err) {
    console.warn(
      `[floor] Could not create issue on ${targetRepo}: ${errorMessage(err)}`,
    );

    return null;
  }
}

/** Parks the task at `awaiting_approval` and returns true when the repo gates this type (FR3.2). */
async function awaitApprovalIfRequired(
  task: PipelineTask,
  targetRepo: string,
  project: Project,
  issueNumber: number | null,
): Promise<boolean> {
  const { requiresApproval, getApprovalLabel } =
    await import("@re-cinq/lore-shared");

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
