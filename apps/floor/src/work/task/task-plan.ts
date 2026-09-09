// How a task runs: which branch, which model, which agent definition, and whether the repo puts it through the Floor-side graph.

import type { PipelineTask } from "@re-cinq/lore-shared";
import type { Project } from "@re-cinq/lore-shared";
import { getTaskTypeConfig } from "../../outbound/config.js";
import { settings } from "../../outbound/queues.js";
import { slugify } from "./task-helpers.js";
import { projectFor } from "../../outbound/project-boot.js";

interface RepoSettings {
  task_overrides?: Record<
    string,
    { model?: string; system_prompt_suffix?: string }
  >;
  dark_factory?: { enabled?: boolean };
  [key: string]: unknown;
}

interface TaskContextBundle {
  branch?: string;
  feedback?: string;
}

/** How this task runs: which branch, which model, which agent definition, and whether the repo puts it through the Floor-side graph. */
export async function resolveTaskPlan(
  task: PipelineTask,
  targetRepo: string,
  project: Awaited<ReturnType<typeof projectFor>>,
) {
  const repoSettings = await readRepoSettings(targetRepo);
  const agentDef = await resolveAgentDef(project, task.task_type);
  const repoOverrides = repoSettings.task_overrides?.[task.task_type];
  const contextBundle = (task.context_bundle || {}) as TaskContextBundle;

  applyRevisionFeedback(task, contextBundle);

  return {
    repoSettings,
    repoOverrides,
    agentDef,
    branchName: resolveBranchName(task, contextBundle),
    model: resolveModel(agentDef, repoOverrides, task.task_type),
    darkFactoryEnabled: repoSettings.dark_factory?.enabled === true,
  };
}

/** Unreadable settings are not a reason to fail the task; the plan falls back to the defaults. */
async function readRepoSettings(targetRepo: string): Promise<RepoSettings> {
  try {
    return (
      ((await settings().rawSettings(targetRepo)) as RepoSettings | null) ?? {}
    );
  } catch {
    return {};
  }
}

/** A revision runs on the branch it is revising, and says what it is revising. */
function applyRevisionFeedback(
  task: PipelineTask,
  contextBundle: TaskContextBundle,
): void {
  if (!contextBundle.feedback) {
    return;
  }

  task.description = `REVISION FEEDBACK: ${contextBundle.feedback}\n\nOriginal task: ${task.description}`;
}

function resolveBranchName(
  task: PipelineTask,
  contextBundle: TaskContextBundle,
): string {
  return (
    contextBundle.branch ||
    `lore/${task.task_type}/${slugify(task.description)}-${task.id.substring(0, 8)}`
  );
}

/** The resolved agent definition wins, then legacy per-repo overrides, then the task-type config. */
function resolveModel(
  agentDef: Awaited<ReturnType<Project["agentDefs"]["resolve"]>> | null,
  repoOverrides: { model?: string } | undefined,
  taskType: string,
): string | undefined {
  return (
    agentDef?.model ||
    repoOverrides?.model ||
    getTaskTypeConfig(taskType)?.model
  );
}

/** Resolved project → org → yaml through the one project.agentDefs seam; an unreadable definition is a missing one, not a failed task. */
async function resolveAgentDef(
  project: Awaited<ReturnType<typeof projectFor>>,
  taskType: string,
): Promise<Awaited<ReturnType<Project["agentDefs"]["resolve"]>> | null> {
  const { agentDefs } = project;

  return agentDefs.resolve(taskType).catch(() => null);
}
