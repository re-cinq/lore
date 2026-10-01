// Binds the spec-task executor to the ports this process holds (composition root).
import {
  floorClient,
  floorConfigured,
} from "@re-cinq/lore-shared/floor/floor-client.js";
import { anthropicCreditsExhausted } from "@re-cinq/lore-shared/llm/credit-probe.js";
import { ensureBranch } from "@re-cinq/lore-shared/project/repo/ensure-branch.js";
import {
  runSpecTaskExecutor,
  type SpecTaskExecutorDeps,
} from "@re-cinq/lore-shared/spec-task/spec-task-executor.js";
import { projectFor } from "../../outbound/project-boot.js";
import { pipeline, taskStore } from "../../outbound/queues.js";

export const NO_FLOOR =
  "no external floor configured: spec-tasks have nowhere to run";

export async function runSpecTaskTick(): Promise<string> {
  return floorConfigured() ? runSpecTaskExecutor(executorDeps()) : NO_FLOOR;
}

function executorDeps(): SpecTaskExecutorDeps {
  const { taskQueue } = pipeline();

  return {
    readyTasks: () => taskQueue.findReadySpecTasks(),
    runningTasks: () => taskQueue.runningSpecTasks(),
    creditsExhausted: () => anthropicCreditsExhausted(),
    claim: claimForTheFloor,
    release: async (taskId) => {
      await taskStore().setStatus(taskId, "pending");
    },
    liveIssue: async (repo, issueNumber) =>
      (await projectFor(repo)).issues.get(issueNumber),
    ensureBranch: async (repo, branch) =>
      ensureBranch((await projectFor(repo)).repo, branch),
    floor: floorClient(),
  };
}

/** The transition is recorded only by whoever won the claim. */
async function claimForTheFloor(taskId: string): Promise<boolean> {
  const won = await pipeline().taskQueue.claimSpecTask(taskId);

  if (won) {
    await taskStore().recordEvent(taskId, "pending", "running", {
      claimed_by: "spec-task-executor",
      runner: "floor",
    });
  }

  return won;
}
