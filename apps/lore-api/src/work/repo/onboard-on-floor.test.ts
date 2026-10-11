import { describe, expect, it } from "vitest";
import { recordedPlanFloor } from "@re-cinq/lore-shared/floor/recorded-plan-floor.js";
import {
  startOnboardingOnFloor,
  type OnboardOnFloorDeps,
} from "./onboard-on-floor.js";

const ONBOARDING = {
  repo: "re-cinq/app",
  taskId: "1234abcd-0000-4000-8000-000000000000",
  ticket: "# Onboard re-cinq/app",
};

function scene(overrides: Partial<OnboardOnFloorDeps> = {}) {
  const recorded = recordedPlanFloor();
  const steps: string[] = [];
  const deps: OnboardOnFloorDeps = {
    floor: recorded.floor,
    ensureBranch: (repo, branch) => {
      steps.push(`branch ${repo} ${branch}`);

      return Promise.resolve();
    },
    failTask: (taskId, reason) => {
      steps.push(`failed ${taskId}: ${reason}`);

      return Promise.resolve();
    },
    ...overrides,
  };
  const started = () =>
    recorded.requests.filter(({ path }) => path.endsWith("/start"));

  return { deps, steps, started };
}

describe("startOnboardingOnFloor", () => {
  it("makes the branch lore/onboard/1234abcd on re-cinq/app before starting the run on it", async () => {
    const { deps, steps, started } = scene();

    await startOnboardingOnFloor(deps, ONBOARDING);

    expect(steps).toEqual(["branch re-cinq/app lore/onboard/1234abcd"]);
    expect(started()[0].body).toMatchObject({
      startItems: {
        repo: { ref: "github.com/re-cinq/app@lore/onboard/1234abcd" },
        task_id: { ref: ONBOARDING.taskId },
      },
    });
  });

  it("fails the task with the reason and rethrows when the branch cannot be made", async () => {
    const { deps, steps, started } = scene({
      ensureBranch: () => Promise.reject(new Error("GitHub App not installed")),
    });

    await expect(startOnboardingOnFloor(deps, ONBOARDING)).rejects.toThrow(
      new Error("GitHub App not installed"),
    );
    expect(steps).toEqual([
      `failed ${ONBOARDING.taskId}: the onboarding could not be started on the floor: GitHub App not installed`,
    ]);
    expect(started()).toEqual([]);
  });
});
