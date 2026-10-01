import { describe, expect, it } from "vitest";
import { hasOpenFloorRunForTask } from "./floor-task-runs.js";
import type { RunView } from "@re-cinq/floor-client";
import { recordedFloor } from "./recorded-floor.js";
import { planRun, recordedPlanFloor } from "./recorded-plan-floor.js";

function loopRunFor(taskId: string): RunView {
  return planRun({
    lineId: "implementation-loop",
    subjectKey: "backlog:tickets",
    startItems: { task_id: { kind: "value", ref: taskId, by: "lore" } },
  });
}

/** A floor that answers the two lists apart: the recorded plan floor does not filter on subject. */
function floorAnswering({ loop }: { loop: RunView[] }) {
  return recordedFloor(({ path }) => ({
    items: path.includes("line=implementation-loop") ? loop : [],
    nextCursor: null,
  })).floor;
}

describe("hasOpenFloorRunForTask", () => {
  it("asks the floor for the open runs on subject task_id:task-1 and for the open implementation-loop runs", async () => {
    const { floor, requests } = recordedPlanFloor();

    await hasOpenFloorRunForTask(floor, "task-1");

    expect(requests.map((request) => request.path).sort()).toEqual([
      "/assembly-runs?line=implementation-loop&open=true",
      "/assembly-runs?subject=task_id%3Atask-1&open=true",
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

  it("answers true while an open implementation-loop run was started with task-1, though it is keyed on the backlog", async () => {
    const floor = floorAnswering({ loop: [loopRunFor("task-1")] });

    expect(await hasOpenFloorRunForTask(floor, "task-1")).toBe(true);
  });

  it("answers false when the open implementation-loop run was started with another task", async () => {
    const floor = floorAnswering({ loop: [loopRunFor("task-2")] });

    expect(await hasOpenFloorRunForTask(floor, "task-1")).toBe(false);
  });

  it("answers false on a deployment with no floor", async () => {
    expect(await hasOpenFloorRunForTask(null, "task-1")).toBe(false);
  });
});
