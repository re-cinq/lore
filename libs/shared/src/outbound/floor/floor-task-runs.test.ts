import { describe, expect, it } from "vitest";
import { hasOpenFloorRunForTask } from "./floor-task-runs.js";
import { planRun, recordedPlanFloor } from "./recorded-plan-floor.js";

describe("hasOpenFloorRunForTask", () => {
  it("asks the floor for the open runs on subject task_id:task-1", async () => {
    const { floor, requests } = recordedPlanFloor();

    await hasOpenFloorRunForTask(floor, "task-1");

    expect(requests).toEqual([
      {
        method: "GET",
        path: "/assembly-runs?subject=task_id%3Atask-1&open=true",
        body: null,
      },
    ]);
  });

  it("answers true while the floor holds an open run for task-1", async () => {
    const { floor } = recordedPlanFloor({ runs: [planRun()] });

    expect(await hasOpenFloorRunForTask(floor, "task-1")).toBe(true);
  });

  it("answers false once the floor's run for task-1 has finished", async () => {
    const { floor } = recordedPlanFloor({
      runs: [planRun({ finishedAt: "2026-10-01T10:00:00.000Z" })],
    });

    expect(await hasOpenFloorRunForTask(floor, "task-1")).toBe(false);
  });

  it("answers false on a deployment with no floor", async () => {
    expect(await hasOpenFloorRunForTask(null, "task-1")).toBe(false);
  });
});
