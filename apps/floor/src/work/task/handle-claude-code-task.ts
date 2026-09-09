import type { PipelineTask } from "@re-cinq/lore-shared";

import { projectFor } from "../../outbound/project-boot.js";
import { buildPrompt, getTaskTypeConfig } from "../../outbound/config.js";
import { agentPrompt } from "../../outbound/agent-invocation.js";
import { ensureTaskBranch } from "./ensure-task-branch.js";
import type {
  AgentRunOpts,
  AgentRunResult,
} from "@re-cinq/lore-shared/project/agents/agent-runner-port.js";
import type { Project } from "@re-cinq/lore-shared";

/** The dark-factory pair travels together or not at all: `assemblyLine` is what turns dark mode on for the dispatch, and `baseBranch` is only meaningful once it has. */
export interface DarkFactoryDispatch {
  assemblyLine: string;
  baseBranch?: string;
}

export interface ClaudeCodeTaskInput {
  task: PipelineTask;
  targetRepo: string;
  branchName: string;
  model?: string;
  repoOverrides?: Record<string, unknown>;
  darkFactory?: DarkFactoryDispatch;
  image?: string;
  agentDef?: { prompt?: string | null; timeout_minutes?: number | null } | null;
}

/** Handle complex tasks (implementation, refactoring) by dispatching an Agent CR to the ai-agent-subsystem via the Project agents port; the agent-watcher job creates the PR when it completes. */
export async function handleClaudeCodeTask(
  input: ClaudeCodeTaskInput,
): Promise<void> {
  const { task, targetRepo, branchName } = input;
  const project = await projectFor(targetRepo);

  // The CR's recipe pins `ref: branchName`, so it must exist before dispatch or the run dies in its init container.
  await ensureTaskBranch(project.repo, branchName);
  const result = await project.agents.run(task.id, agentRunSpec(input));

  await settleDispatch(result, input, project);
}

function agentRunSpec(input: ClaudeCodeTaskInput): AgentRunOpts {
  const { task, branchName, agentDef } = input;

  return {
    mode: "cluster",
    taskType: task.task_type,
    ...bundleFields(task),
    description: task.description,
    // The recipe's own prompt wins over the built-in one; the task description is appended either way, since a recipe describes the JOB and the task says which instance of it.
    prompt: agentPrompt(
      promptOverride(agentDef),
      task.description,
      buildPrompt(task.task_type, task.description),
    ),
    branch: branchName,
    ...runSettings(input),
  };
}

/** The four `context_bundle` fields `agentRunSpec` threads onto the CR opts. */
interface ContextBundleFields {
  featureId: unknown;
  roundFeedback: unknown;
  resumeFromTask: unknown;
  lineArgs: unknown;
}

/** Everything the Agent CR is dispatched with. */
/** The context-bundle fields, threaded onto the run so a line's `continues.key: args.feature_id` resolves — the assembly-line engine itself never learns what a feature is. Each is spread conditionally: an explicitly-undefined key is not the same as an absent one to the recipe renderer. */
function bundleFields(task: ClaudeCodeTaskInput["task"]) {
  const { featureId, roundFeedback, resumeFromTask, lineArgs } =
    contextBundleFields(task);

  return {
    ...optionalStringField("featureId", featureId),
    ...optionalStringField("roundFeedback", roundFeedback),
    ...optionalStringField("resumeFromTask", resumeFromTask),
    ...optionalLineArgs(lineArgs),
  };
}

function contextBundleFields(task: PipelineTask): ContextBundleFields {
  return {
    featureId: task.context_bundle?.feature_id,
    roundFeedback: task.context_bundle?.round_feedback,
    resumeFromTask: task.context_bundle?.resume_from_task,
    lineArgs: task.context_bundle?.line_args,
  };
}

/** A `string`-typed `context_bundle` field, spread onto the CR opts only when present — an unset field stays absent rather than becoming an explicit undefined the CR would carry. */
function optionalStringField<
  K extends "featureId" | "roundFeedback" | "resumeFromTask",
>(key: K, value: unknown): Partial<Pick<AgentRunOpts, K>> {
  return typeof value === "string"
    ? ({ [key]: value } as Pick<AgentRunOpts, K>)
    : {};
}

/** Seed values for the assembly run's `args` — only a plain object counts (not an array, not a primitive). */
function optionalLineArgs(lineArgs: unknown): Pick<AgentRunOpts, "lineArgs"> {
  if (lineArgs && typeof lineArgs === "object" && !Array.isArray(lineArgs)) {
    return { lineArgs: lineArgs as Record<string, unknown> };
  }

  return {};
}

/** The agent definition's prompt override, resolved once so callers never optional-chain into it themselves. */
function promptOverride(
  agentDef: ClaudeCodeTaskInput["agentDef"],
): string | null | undefined {
  return agentDef?.prompt;
}

/** The knobs a repo can turn: model, timeout, image, and the dark-factory block. The default model is named here rather than in a recipe, so a task type with no agent-definition row still dispatches. */
function runSettings(input: ClaudeCodeTaskInput) {
  const { task, model, repoOverrides, darkFactory, image, agentDef } = input;

  return {
    model: model || "claude-sonnet-4-6",
    timeoutMinutes: resolveTimeoutMinutes(
      agentDef,
      repoOverrides,
      task.task_type,
    ),
    ...optionalImage(image),
    ...optionalDarkFactory(darkFactory),
  };
}

/** Agent-definition timeout wins, then the repo override, then the task-type default, then a flat fallback. */
function resolveTimeoutMinutes(
  agentDef: ClaudeCodeTaskInput["agentDef"],
  repoOverrides: ClaudeCodeTaskInput["repoOverrides"],
  taskType: string,
): number {
  const candidates: (number | null | undefined)[] = [
    agentDef?.timeout_minutes,
    repoOverrides?.timeout_minutes as number | undefined,
    getTaskTypeConfig(taskType)?.timeout_minutes,
  ];

  return candidates.find((value) => Boolean(value)) ?? 30;
}

function optionalImage(image?: string): Pick<AgentRunOpts, "image"> {
  return image ? { image } : {};
}

/** `workflowName` is the CR-spec wire field (read by the pod via LORE_DARK_FACTORY_WORKFLOW) — renaming it needs both sides. */
function optionalDarkFactory(
  darkFactory?: DarkFactoryDispatch,
): Pick<AgentRunOpts, "extraLabels" | "darkFactory"> {
  if (!darkFactory) {
    return {};
  }

  return {
    extraLabels: { "lore.re-cinq.com/dark-factory": "true" },
    darkFactory: {
      workflowName: darkFactory.assemblyLine,
      baseBranch: darkFactory.baseBranch ?? "main",
    },
  };
}

/** What the dispatch left behind. Only two of the three outcomes settle the task here; a real cluster dispatch is settled later by the agent-watcher. */
async function settleDispatch(
  result: AgentRunResult,
  input: ClaudeCodeTaskInput,
  project: Project,
): Promise<void> {
  if (result.completion) {
    await finalizeInline(result.completion, input, project);

    return;
  }

  if (result.joinedRun) {
    await settleJoinedRun(input.task.id, result.joinedRun, project);

    return;
  }

  logDispatchOutcome(result, input.task.id);
}

/** A synchronous Station backend carries completion back for inline finalize; the async agent-cr (K8s) backend omits it — the agent-watcher resolves it later (ADR-028). */
async function finalizeInline(
  completion: NonNullable<AgentRunResult["completion"]>,
  input: ClaudeCodeTaskInput,
  project: Project,
): Promise<void> {
  const { finalizeStationRun } = await import("./finalize-station-run.js");

  await finalizeStationRun({
    task: input.task,
    targetRepo: input.targetRepo,
    branch: input.branchName,
    completion,
    project,
  });
}

/** A joined dispatch started nothing — another run already held this subject — so the task is DONE; leaving it `running` would strand it until the stale sweep (pre-subject-guard duplicate-click symptom). */
async function settleJoinedRun(
  taskId: string,
  joinedRun: string,
  project: Project,
): Promise<void> {
  // `completed` with NO failure_reason: the task page renders failure_reason in failure styling, which would misreport a succeeded task.
  await project.tasks.setStatus(taskId, "completed");
  console.log(
    `[floor] task ${taskId} joined run ${joinedRun}; nothing dispatched`,
  );
}

/** Don't set pr-created — the agent-watcher will do that when the Agent completes; the dispatch only says whether a CR was started. */
function logDispatchOutcome(result: AgentRunResult, taskId: string): void {
  console.log(
    result.started
      ? `[floor] Dispatched Agent CR for task ${taskId}`
      : `[floor] Agent CR for task ${taskId} already exists, skipping`,
  );
}
