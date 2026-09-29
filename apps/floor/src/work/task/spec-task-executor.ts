/** Every minute, picks up ready spec-tasks and dispatches an Agent CR (ADR-031) to implement each, admitted by `admitSpecTasks`: at most 3 per task_group_id, and never two of a group together that edit one file or where either is not parallelizable. */
import type { ReadySpecTask } from "@re-cinq/lore-shared/project/tasks/task-queue-port.js";
import type { IssueRef } from "@re-cinq/lore-shared/project/lib/github-port.js";

import { anthropicCreditsExhausted } from "@re-cinq/lore-shared/llm/credit-probe.js";
import { projectFor } from "../../outbound/project-boot.js";
import { defaultTaskPrompt } from "../../outbound/config.js";
import { agentPrompt } from "../../outbound/agent-invocation.js";
import { pipeline } from "../../outbound/queues.js";
import { setStatus, insertEvent } from "./task-helpers.js";
import { ensureTaskBranch } from "./ensure-task-branch.js";
import { admitSpecTasks } from "./spec-task-admission.js";
import { taskIssueBody } from "@re-cinq/lore-shared/feature-planning/issue-bodies.js";
import { taskIssueDetail } from "@re-cinq/lore-shared/feature-planning/decomposition-result.js";

export async function specTaskExecutorJob(): Promise<string> {
  const readyTasks = await pipeline().taskQueue.findReadySpecTasks();

  if (readyTasks.length === 0) {
    return "No ready spec-tasks";
  }

  if (await anthropicCreditsExhausted()) {
    console.warn(
      "[spec-task-executor] API credits exhausted, skipping dispatch",
    );

    return "Skipped: API credits exhausted";
  }
  const dispatched = await dispatchReadyTasks(readyTasks);

  return dispatched > 0
    ? `Dispatched ${dispatched}/${readyTasks.length} ready spec-tasks`
    : "No ready spec-tasks";
}

/** Dispatches the ready tasks the admission lets start beside what their groups already run; admission is decided for the whole sweep at once, so it holds within one tick as well as across ticks. */
async function dispatchReadyTasks(
  readyTasks: ReadySpecTask[],
): Promise<number> {
  const admitted = admitSpecTasks(
    readyTasks,
    await pipeline().taskQueue.runningSpecTasks(),
  );
  let dispatched = 0;

  for (const task of admitted) {
    if (await dispatchSpecTask(task)) {
      dispatched++;
    }
  }

  return dispatched;
}

/** Claim one ready spec-task and dispatch its Agent CR; returns whether a CR actually started. A failure after the claim returns the task to `pending` so the next tick retries it. */
async function dispatchSpecTask(task: ReadySpecTask): Promise<boolean> {
  if (!(await pipeline().taskQueue.claimSpecTask(task.id))) {
    return false;
  }
  await insertEvent(task.id, "pending", "running", {
    claimed_by: "spec-task-executor",
  });

  return runClaimed(task);
}

/** Runs a task this executor has already claimed. A dispatch failure RELEASES the claim back to `pending`: the row is claimed but nothing is running, and only a release lets the next tick try again. */
async function runClaimed(task: ReadySpecTask): Promise<boolean> {
  const brief = specTaskBrief(task);

  try {
    const result = await runSpecTaskAgent(task);

    return result.started
      ? recordDispatch(task, brief)
      : reportDispatchRace(task);
  } catch (err) {
    await setStatus(task.id, "pending");
    console.error(
      `[spec-task-executor] Failed to dispatch Agent for ${task.id}: ${(err as Error).message}`,
    );

    return false;
  }
}

type SpecTaskBrief = ReturnType<typeof specTaskBrief>;

/** Runs as an `implementation` agent, but LABELLED `spec-task`: the recipe is the same, the provenance is not, and the label is what the run page and every later query read. */
async function runSpecTaskAgent(
  task: ReadySpecTask,
): Promise<{ started: boolean }> {
  return startSpecTaskAgent(await projectFor(task.target_repo), task);
}

type SpecTaskProject = Pick<
  Awaited<ReturnType<typeof projectFor>>,
  "repo" | "agentDefs" | "agents" | "issues"
>;

/** Creates the task's branch when missing, then runs its agent on it — the pod checks the branch out, so an agent dispatched onto a branch nobody made dies in init (plan 3b3a67af's T001–T003, 2026-09-29). */
export async function startSpecTaskAgent(
  project: SpecTaskProject,
  task: ReadySpecTask,
): Promise<{ started: boolean }> {
  const brief = specTaskBrief(task, await liveIssue(project, task));

  await ensureTaskBranch(project.repo, brief.branchName);
  const recipe = await project.agentDefs.resolve("implementation");

  return await project.agents.run(task.id, specTaskRunOpts(recipe, brief));
}

// The task issue as it reads now, so a person's edit between filing and dispatch reaches the agent; a task with no issue, or a GitHub read that fails, briefs from what was filed instead of holding the dispatch.
async function liveIssue(
  project: SpecTaskProject,
  task: ReadySpecTask,
): Promise<LiveIssue | undefined> {
  const number = task.context_bundle?.task_issue;

  if (typeof number !== "number") {
    return undefined;
  }

  try {
    return (await project.issues.get(number)) ?? undefined;
  } catch (err) {
    console.warn(
      `[spec-task-executor] task issue #${number} unreadable, briefing from the filed detail: ${(err as Error).message}`,
    );

    return undefined;
  }
}

type LiveIssue = Pick<IssueRef, "title" | "body">;

type ImplementationRecipe = Awaited<
  ReturnType<Awaited<ReturnType<typeof projectFor>>["agentDefs"]["resolve"]>
>;

/** The resolved implementation recipe drives prompt, model and timeout; the literal defaults only cover a repo with no such row. */
function specTaskRunOpts(recipe: ImplementationRecipe, brief: SpecTaskBrief) {
  const { description } = brief;

  return {
    mode: "cluster" as const,
    taskType: "implementation",
    description,
    prompt: agentPrompt(
      recipe?.prompt,
      description,
      defaultTaskPrompt(description),
    ),
    branch: brief.branchName,
    model: recipe?.model || "claude-sonnet-4-6",
    timeoutMinutes: recipe?.timeout_minutes || 90,
    extraLabels: specTaskLabels(brief),
  };
}

/** The CR's metadata labels. extraLabels is spread last by the agent runner, so task-type here overrides the recipe's "implementation". */
function specTaskLabels(brief: SpecTaskBrief): Record<string, string> {
  return {
    "lore.re-cinq.com/task-type": "spec-task",
    ...(brief.specSlug
      ? { "lore.re-cinq.com/spec-slug": labelValue(brief.specSlug) }
      : {}),
  };
}

/** A Kubernetes label value: alphanumerics, dot, dash and underscore, 63 chars. */
function labelValue(specSlug: string): string {
  return (
    specSlug
      .replace(/[^a-zA-Z0-9._-]/g, "")
      .replace(/^-+|-+$/g, "")
      .substring(0, 63) || "unknown"
  );
}

/** An existing CR means another dispatcher won; the claim stays with it, not with us. */
function reportDispatchRace(task: ReadySpecTask): boolean {
  console.log(
    `[spec-task-executor] Agent CR for ${task.id} already exists, skipping`,
  );

  return false;
}

function recordDispatch(task: ReadySpecTask, brief: SpecTaskBrief): boolean {
  console.log(
    `[spec-task-executor] Dispatched ${brief.specTaskId} (${task.id}) → Agent CR`,
  );

  return true;
}

/** What the agent is told to build, and where it builds it. */
function specTaskBrief(task: ReadySpecTask, live?: LiveIssue) {
  const cb = (task.context_bundle ?? {}) as Record<string, unknown> & {
    spec_slug?: string;
    spec_task_id?: string;
  };
  const detail = live?.body ?? briefDetail(task, cb);

  return {
    specSlug: cb.spec_slug,
    specTaskId: cb.spec_task_id,
    description: `${briefHeader(task, cb, live?.title)}\n\n${detail}${specRef(cb.spec_slug)}`,
    branchName: specTaskBranch(task, cb),
  };
}

function specRef(specSlug: string | undefined): string {
  return specSlug
    ? `\n\nREAD specs/${specSlug}/spec.md, specs/${specSlug}/plan.md and specs/${specSlug}/tasks.md first for full context.`
    : "";
}

function specTaskBranch(
  task: ReadySpecTask,
  cb: { spec_slug?: string; spec_task_id?: string },
): string {
  const slug = cb.spec_slug || "spec-task";

  return `lore/spec-task/${slug}-${(cb.spec_task_id || "").toLowerCase()}-${task.id.substring(0, 8)}`;
}

// The issue is filed as `T001: <title>`, so its live title is read back without that prefix.
function briefHeader(
  task: ReadySpecTask,
  cb: Record<string, unknown>,
  liveTitle?: string,
): string {
  const taskId = String(cb.spec_task_id);
  const issue =
    typeof cb.task_issue === "number" ? ` (issue #${cb.task_issue})` : "";
  const filedTitle = typeof cb.title === "string" ? cb.title : task.description;
  const title = liveTitle?.replace(`${taskId}: `, "") ?? filedTitle;

  return `Implement spec-task ${taskId}${issue}: ${title}`;
}

// The same Markdown its task issue carries, so the agent works from what a developer would read.
function briefDetail(task: ReadySpecTask, cb: Record<string, unknown>): string {
  return taskIssueBody({
    repo: task.target_repo,
    ...(typeof cb.story_issue === "number"
      ? { storyNumber: cb.story_issue }
      : {}),
    dependsOn: [],
    task: {
      id: String(cb.spec_task_id),
      description: task.description,
      depends_on: [],
      parallelizable: false,
      phase: 0,
      ...(typeof cb.file_path === "string" ? { file_path: cb.file_path } : {}),
      ...taskIssueDetail(cb),
    },
  });
}
