import { describe, expect, it } from "vitest";
import {
  PLAN_BLOB_HASH,
  recordedPlanFloor,
} from "../../outbound/floor/recorded-plan-floor.js";
import { onboardBranchOf, startOnboardRun } from "./floor-onboard.js";

const TASK_ID = "1234abcd-0000-4000-8000-000000000000";

describe("onboardBranchOf", () => {
  it("names the branch lore/onboard/1234abcd for task 1234abcd-…", () => {
    expect(onboardBranchOf(TASK_ID)).toBe("lore/onboard/1234abcd");
  });
});

describe("startOnboardRun", () => {
  it("starts the onboard line for github.com/re-cinq/app on the branch, the task and the stored ticket", async () => {
    const { floor, requests } = recordedPlanFloor();

    await startOnboardRun(floor, {
      repo: "re-cinq/App",
      branch: "lore/onboard/1234abcd",
      taskId: TASK_ID,
      ticket: "# Onboard re-cinq/App",
    });

    expect(requests.at(-1)).toEqual({
      method: "POST",
      path: "/assembly-lines/onboard/start",
      body: {
        repo: "github.com/re-cinq/app",
        startItems: {
          repo: {
            kind: "git",
            ref: "github.com/re-cinq/app@lore/onboard/1234abcd",
            by: "lore",
          },
          task_id: { kind: "value", ref: TASK_ID, by: "lore" },
          ticket: { kind: "file", ref: PLAN_BLOB_HASH, by: "lore" },
        },
      },
    });
  });

  it("answers the id of the run it started", async () => {
    const { floor } = recordedPlanFloor();

    expect(
      await startOnboardRun(floor, {
        repo: "re-cinq/app",
        branch: "lore/onboard/1234abcd",
        taskId: TASK_ID,
        ticket: "ticket",
      }),
    ).toBe("run-new");
  });
});
