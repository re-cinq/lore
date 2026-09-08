import type { PipelineTask } from "@re-cinq/lore-shared";
import { taskPageUrl } from "../../domain/agent-watcher-logic.js";
import { errorMessage } from "@re-cinq/lore-shared";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
/** Core task processing worker: polls pipeline.tasks, dispatches to the LLM, creates branches + PRs. */

import { projectFor } from "../../outbound/project-boot.js";
import {
  classifyError,
  TaskFailure,
  resolveExecutionImage,
} from "@re-cinq/lore-shared";
import type { Project } from "@re-cinq/lore-shared";
import { setStatus, insertEvent } from "./task-helpers.js";
import { pipeline } from "../../outbound/queues.js";
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

export { isFeatureLifecycleType } from "../../domain/task-lifecycle-type.js";
import { isFeatureLifecycleType } from "../../domain/task-lifecycle-type.js";

// ── Crash recovery ────────────────────────────────────────────────────

/** Dependencies of {@link recoverStaleTasks}, injectable so the policy is testable against the InMemory queue with no DB. */
export interface RecoverStaleDeps {
  queue: Pick<TaskQueueRepository, "findRecoverable">;
  setStatus: typeof setStatus;
  insertEvent: typeof insertEvent;
  /** True while an assembly line for this task is still queued or running. */
  hasOpenLine: (taskId: string) => Promise<boolean>;
}

/** Built per call, never at module load: `pipeline()` needs an initialized pool, so binding it eagerly would break import order. */
function liveRecoverStaleDeps(): RecoverStaleDeps {
  return {
    queue: pipeline().taskQueue,
    setStatus,
    insertEvent,
    hasOpenLine: async (taskId) =>
      (await pipeline().assemblyRuns.listForTask(taskId)).some(
        (line) => line.status === "running" || line.status === "queued",
      ),
  };
}

/** Resets one stale row back to pending; returns false when its assembly line is still open, so the row is left alone. */
async function recoverOneStaleTask(
  row: { id: string; task_type: string },
  deps: RecoverStaleDeps,
): Promise<boolean> {
  // Not stale — its line is still walking (or parked on a person).
  if (await deps.hasOpenLine(row.id)) {
    return false;
  }
  await deps.setStatus(row.id, "pending");
  await deps.insertEvent(row.id, "running", "pending", {
    reason: "crash-recovery",
  });
  console.log(
    `[floor] Recovered stale task ${row.id} (${row.task_type}) → pending`,
  );

  return true;
}

/** Resets tasks stuck in running/queued 30+ min back to pending; the open-line check (not just age) prevents re-dispatching a task parked on a human for days on every boot. */
export async function recoverStaleTasks(
  deps: RecoverStaleDeps = liveRecoverStaleDeps(),
): Promise<number> {
  const stale = await deps.queue.findRecoverable();

  let recovered = 0;

  for (const row of stale) {
    if (await recoverOneStaleTask(row, deps)) {
      recovered++;
    }
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

/** The assembly line this dispatch should walk, or undefined for a plain single-Agent run. */
function assemblyLineFor(input: DispatchInput): string | undefined {
  return input.isFeaturePlanningType || input.darkFactoryEnabled
    ? input.task.task_type
    : undefined;
}

/** BYO execution container (ADR-025): default → per-repo → per-task-type; unset means the controller's default. */
function executionImageFor(
  input: DispatchInput,
): ReturnType<typeof resolveExecutionImage> {
  return resolveExecutionImage(
    input.repoSettings as Parameters<typeof resolveExecutionImage>[0],
    input.task.task_type,
  );
}

/** Dark-mode repos and feature-planning/finalize run the Floor-side graph, one Agent CR per node (ADR-028). */
async function dispatchAgentCr(input: DispatchInput): Promise<void> {
  const { task, targetRepo, project } = input;
  const assemblyLine = assemblyLineFor(input);
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
    image: executionImageFor(input),
    agentDef: input.agentDef,
  });
}

/** Best-effort note on the Issue naming the agent that picked the task up, with the pipeline link when the UI URL is configured. */
async function commentPickedUp(
  project: Awaited<ReturnType<typeof projectFor>>,
  issueNumber: number,
  task: PipelineTask,
  agentId: string,
): Promise<void> {
  const pipelineUrl = taskPageUrl(task.id, process.env.LORE_UI_URL);

  const { issues } = project;

  await issues
    .comment(
      issueNumber,
      `Agent \`${agentId}\` picked up this task.` +
        (pipelineUrl ? ` Follow it on the pipeline: ${pipelineUrl}` : ""),
    )
    .catch(() => {});
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
  await commentPickedUp(project, issueNumber, task, agentId);
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

/** The claimed task plus everything resolved around it before a handler is chosen. */
interface TaskDispatch {
  task: PipelineTask;
  targetRepo: string;
  issueNumber: number | null;
  project: Project;
  isFeaturePlanningType: boolean;
}

/** Plans the task and hands it to its handler. The GitHub check happens AFTER planning and before dispatch: planning is free, but a run that reaches the end with no way to open a PR has spent a pod for nothing. */
async function dispatchTask(input: TaskDispatch): Promise<void> {
  const { task, targetRepo, project } = input;
  const plan = await resolveTaskPlan(task, targetRepo, project);

  enforceTrue(
    project.repo.isConfigured(),
    Error,
    "GitHub App not configured — cannot create PR",
  );
  await dispatchByTaskType(routeTask(task.task_type), { ...input, ...plan });
}

/** Everything a claimed task needs before dispatch: its Issue, and whether it is a feature-lifecycle type. */
async function prepareTask(
  task: PipelineTask,
  targetRepo: string,
  project: Project,
): Promise<TaskDispatch> {
  // Feature lifecycle runs through the Station (ADR-028), forced below regardless of dark-factory; also gates Issue creation (decompose files its own).
  const isFeaturePlanningType = isFeatureLifecycleType(task.task_type);
  const issueNumber = await ensureIssue(
    task,
    targetRepo,
    project,
    isFeaturePlanningType,
  );

  return { task, targetRepo, project, issueNumber, isFeaturePlanningType };
}

/** A dispatch failure is the task's failure, recorded against the task and its Issue rather than thrown at the poll loop. */
async function dispatchOrFail(dispatch: TaskDispatch): Promise<void> {
  try {
    await dispatchTask(dispatch);
  } catch (err) {
    await handleProcessTaskFailure(
      dispatch.task,
      dispatch.project,
      dispatch.issueNumber,
      err,
    );
  }
}

async function processTask(task: PipelineTask): Promise<void> {
  const agentId = `lore-agent-${task.id.substring(0, 8)}`;
  const targetRepo = task.target_repo || "re-cinq/lore";
  const project = await projectFor(targetRepo);
  const dispatch = await prepareTask(task, targetRepo, project);
  const { issueNumber } = dispatch;

  if (await awaitApprovalIfRequired(task, targetRepo, project, issueNumber)) {
    return; // Don't process yet — waiting on the approval label
  }

  await claimTask(task, agentId, project, issueNumber);
  await dispatchOrFail(dispatch);
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
