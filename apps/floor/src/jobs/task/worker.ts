import type { PipelineTask } from "@re-cinq/lore-shared";
import { taskPageUrl } from "../watcher/agent-watcher-logic.js";
import { errorMessage } from "@re-cinq/lore-shared";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
/** Core task processing worker: polls pipeline.tasks, dispatches to the LLM, creates branches + PRs. */

import { projectFor } from "../../composition/project-boot.js";
import {
  classifyError,
  TaskFailure,
  resolveExecutionImage,
} from "@re-cinq/lore-shared";
import type { Project } from "@re-cinq/lore-shared";
import { setStatus, insertEvent } from "./task-helpers.js";
import { pipeline } from "../../kernel/queues.js";
import type { TaskQueueRepository } from "@re-cinq/lore-shared/project/tasks/task-queue-port.js";
import { handleFeatureRequest } from "./handle-feature-request.js";
import { handleClaudeCodeTask } from "./handle-claude-code-task.js";
import { handleOnboard } from "./handle-onboard.js";
import {
  awaitApprovalIfRequired,
  commentTaskFailureOnIssue,
  ensureIssue,
} from "./task-issue.js";
import { resolveTaskPlan } from "./task-plan.js";

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

async function handleProcessTaskFailure(
  task: PipelineTask,
  project: Project,
  issueNumber: number | null,
  err: unknown,
): Promise<void> {
  const failureReason: string = errorMessage(err);
  const meta =
    err instanceof TaskFailure
      ? { error: failureReason, details: err.details }
      : { error: failureReason, ...classifyError(failureReason) };

  await setStatus(task.id, "failed", {
    failure_reason: failureReason,
  });
  await insertEvent(task.id, "running", "failed", meta);

  if (issueNumber) {
    await commentTaskFailureOnIssue(project, issueNumber, failureReason, meta);
  }
  console.error(`[floor] Task ${task.id} failed: ${failureReason}`);
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
    await handleProcessTaskFailure(task, project, issueNumber, err);
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
