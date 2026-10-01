// Hands a new onboarding to the external floor (ADR-049): the task's branch is made, and the onboard line is started on it with the ticket. The task row was created already running, so the old Floor's worker never claims it; a start that fails therefore has to fail the task itself, or the repo would look mid-onboarding forever.

import { PgTaskStore } from "@re-cinq/lore-shared/project/tasks/task-store-pg.js";
import {
  floorClient,
  floorConfigured,
} from "@re-cinq/lore-shared/floor/floor-client.js";
import { errorMessage } from "@re-cinq/lore-shared/lib/error-classify.js";
import {
  onboardBranchOf,
  startOnboardRun,
  type OnboardFloor,
} from "@re-cinq/lore-shared/onboard/floor-onboard.js";
import type { PgPool } from "@re-cinq/lore-shared";
import type { Pool } from "pg";
import { projectFor } from "../../outbound/project-boot.js";
import { ensureBranch } from "@re-cinq/lore-shared/project/repo/ensure-branch.js";

export interface OnboardOnFloorDeps {
  floor: OnboardFloor;
  ensureBranch(repo: string, branch: string): Promise<void>;
  failTask(taskId: string, reason: string): Promise<void>;
}

export interface FloorOnboarding {
  repo: string;
  taskId: string;
  ticket: string;
}

export async function startOnboardingOnFloor(
  deps: OnboardOnFloorDeps,
  onboarding: FloorOnboarding,
): Promise<void> {
  const branch = onboardBranchOf(onboarding.taskId);

  try {
    await deps.ensureBranch(onboarding.repo, branch);
    await startOnboardRun(deps.floor, { ...onboarding, branch });
  } catch (err) {
    await deps.failTask(
      onboarding.taskId,
      `the onboarding could not be started on the floor: ${errorMessage(err)}`,
    );
    throw err;
  }
}

/** Hands a committed onboarding to the external floor; null on a deployment with no floor, where the old Floor's worker claims the pending task. */
export type FloorStart =
  ((onboarding: FloorOnboarding) => Promise<void>) | null;

export function floorStartFor(pool: Pool): FloorStart {
  return floorConfigured()
    ? (onboarding) =>
        startOnboardingOnFloor(onboardOnFloorDeps(pool), onboarding)
    : null;
}

function onboardOnFloorDeps(pool: Pool): OnboardOnFloorDeps {
  const tasks = new PgTaskStore(pool);

  return {
    floor: floorClient(),
    ensureBranch: async (repo, branch) =>
      ensureBranch((await projectFor(repo)).repo, branch),
    failTask: async (taskId, reason) => {
      if (
        await tasks.setStatusIf(taskId, "running", "failed", {
          failure_reason: reason,
        })
      ) {
        await tasks.recordEvent(taskId, "running", "failed", { error: reason });
      }
    },
  };
}

/** Inside the transaction that creates the task, so there is no moment at which the old Floor's worker could claim it as pending. */
export async function markRunningOnFloor(
  client: PgPool,
  taskId: string,
): Promise<void> {
  const tasks = new PgTaskStore(client);

  await tasks.setStatusIf(taskId, "pending", "running");
  await tasks.recordEvent(taskId, "pending", "running", { runner: "floor" });
}
