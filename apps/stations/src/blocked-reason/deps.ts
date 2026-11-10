// The blocked-reason station's composition root: the repo's Project, the pr_blocked_reasons table and Lore's App login.

import {
  floorClient,
  floorConfigured,
} from "@re-cinq/lore-shared/floor/floor-client.js";
import { autoMergeEnabled } from "@re-cinq/lore-shared/loops/loop-enabled.js";
import { loreAppLogin } from "@re-cinq/lore-shared/project/github-installations/lore-app-login.js";
import type { TaskList } from "@re-cinq/lore-shared/project/tasks/task-list.js";
import { openFloorReviewCount } from "@re-cinq/lore-shared/review/floor-review-runs.js";
import { REVIEW_DEFINITIONS } from "@re-cinq/lore-shared/review/review-definitions.js";
import { projectFor } from "../outbound/project-boot.js";
import { pipeline } from "../outbound/queues.js";
import type {
  BlockedReasonDeps,
  BlockedReasonProject,
  TaskGroupRef,
} from "./station.js";

/** Called on each delivery, after the pool exists. */
export function productionDeps(): BlockedReasonDeps {
  return {
    appLogin: loreAppLogin,
    reasons: pipeline().prBlockedReasons,
    project: buildProject,
  };
}

async function buildProject(repo: string): Promise<BlockedReasonProject> {
  const project = await projectFor(repo);
  const { tasks } = project;

  return {
    pulls: project.pulls,
    issues: project.issues,
    repo: project.repo,
    audit: project.audit,
    taskIssue: async (taskId) =>
      (await tasks.getById(taskId))?.issueNumber ?? null,
    autoMergeOn: async () =>
      autoMergeEnabled(await project.settings.rawSettings()),
    taskGroup: (prNumber) => readTaskGroup(repo, prNumber, tasks),
    hasReviewInFlight: (prNumber) => reviewInFlight(repo, prNumber),
  };
}

async function readTaskGroup(
  repo: string,
  prNumber: number,
  tasks: TaskList,
): Promise<TaskGroupRef | undefined> {
  const latest = await pipeline().taskQueue.latestTaskByPr(repo, prNumber);
  const task = latest ? await tasks.getById(latest.id) : null;

  if (!task?.taskGroupId) {
    return undefined;
  }
  const raw = task.contextBundle?.depends_on;
  const depends_on = Array.isArray(raw)
    ? raw.filter((n): n is number => typeof n === "number")
    : undefined;

  return { task_group_id: task.taskGroupId, depends_on };
}

async function reviewInFlight(
  repo: string,
  prNumber: number,
): Promise<boolean> {
  const openRuns = await pipeline().assemblyRuns.findOpenByPr(repo, prNumber);
  const inDb = openRuns.some((r) =>
    REVIEW_DEFINITIONS.includes(r.blueprintName),
  );
  const onFloor = floorConfigured()
    ? (await openFloorReviewCount(floorClient(), { repo, prNumber })) > 0
    : false;

  return inDb || onFloor;
}
