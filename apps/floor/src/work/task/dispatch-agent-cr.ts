// One task's dispatch onto the ai-agent-subsystem: which line it walks (if any), which image, off which base branch. Split out of the worker so onboarding can enrol the repo first and then dispatch exactly the way the worker does.

import { errorMessage, resolveExecutionImage } from "@re-cinq/lore-shared";
import type { PipelineTask, Project } from "@re-cinq/lore-shared";
import { handleClaudeCodeTask } from "./handle-claude-code-task.js";
import type { projectFor } from "../../outbound/project-boot.js";

export interface DispatchInput {
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

/** Task types that ALWAYS walk their assembly line, dark mode or not: onboarding produces one PR from one ticket, and only the line's push node opens it. */
const ALWAYS_LINE_TASK_TYPES = new Set(["onboard"]);

/** The assembly line this dispatch should walk, or undefined for a plain single-Agent run. */
export function assemblyLineFor(
  input: Pick<
    DispatchInput,
    "task" | "isFeaturePlanningType" | "darkFactoryEnabled"
  >,
): string | undefined {
  const taskType = input.task.task_type;

  return ALWAYS_LINE_TASK_TYPES.has(taskType) ||
    input.isFeaturePlanningType ||
    input.darkFactoryEnabled
    ? taskType
    : undefined;
}

/** Dark-mode repos, feature-planning/finalize and onboarding run the Floor-side graph, one Agent CR per node (ADR-028). */
export async function dispatchAgentCr(input: DispatchInput): Promise<void> {
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

/** BYO execution container (ADR-025): default → per-repo → per-task-type; unset means the controller's default. */
function executionImageFor(
  input: DispatchInput,
): ReturnType<typeof resolveExecutionImage> {
  return resolveExecutionImage(
    input.repoSettings as Parameters<typeof resolveExecutionImage>[0],
    input.task.task_type,
  );
}
