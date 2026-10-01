import { describe, expect, it } from "vitest";
import type { Report, Tools } from "@re-cinq/floor-station";
import type { RunView } from "@re-cinq/floor-client";
import { settlingTasks, type TaskSettlement } from "./settle-task.js";

const TOOLS: Tools = {
  read: () => Promise.resolve(Buffer.from("")),
  produce: () => Promise.resolve(),
  modelCall: () => Promise.resolve(),
  signal: new AbortController().signal,
};

const NEXT: Report = { outcome: "success" };

function onboardRun(overrides: Partial<RunView> = {}): RunView {
  return {
    id: "run-1",
    lineId: "onboard",
    lineHash: "hash",
    repo: "github.com/re-cinq/app",
    subjectKey: "task_id:task-1",
    startItems: { task_id: { kind: "value", ref: "task-1", by: "lore" } },
    createdAt: "2026-10-01T09:00:00.000Z",
    outcome: "success",
    reason: null,
    finishedAt: "2026-10-01T10:00:00.000Z",
    ...overrides,
  };
}

function scene(run: RunView | null) {
  const settled: TaskSettlement[] = [];
  const handle = settlingTasks(
    {
      run: () => Promise.resolve(run),
      settle: (settlement) => {
        settled.push(settlement);

        return Promise.resolve();
      },
    },
    () => Promise.resolve(NEXT),
  );
  const settle = (lineId: string, outcome: string) =>
    handle(
      {
        visitId: "visit-1",
        iteration: 1,
        needs: { run_id: "run-1", line_id: lineId, outcome },
      },
      TOOLS,
    );

  return { settle, settled };
}

describe("settlingTasks", () => {
  it("completes task-1 when its onboard run settled as success", async () => {
    const { settle, settled } = scene(onboardRun());

    await settle("onboard", "success");

    expect(settled).toEqual([
      {
        taskId: "task-1",
        runId: "run-1",
        outcome: "success",
        status: "completed",
      },
    ]);
  });

  it("fails task-1 with the run's reason when its onboard run was cancelled", async () => {
    const { settle, settled } = scene(
      onboardRun({
        outcome: "cancelled",
        reason: "the pull request was closed without merging",
      }),
    );

    await settle("onboard", "cancelled");

    expect(settled).toEqual([
      {
        taskId: "task-1",
        runId: "run-1",
        outcome: "cancelled",
        status: "failed",
        failureReason: "the pull request was closed without merging",
      },
    ]);
  });

  it("fails task-1 naming the outcome when the run gave no reason", async () => {
    const { settle, settled } = scene(onboardRun({ outcome: "iteration_max" }));

    await settle("onboard", "iteration_max");

    expect(settled[0].failureReason).toBe(
      "the onboard run ended as iteration_max",
    );
  });

  it("settles no task for a code-review run", async () => {
    const { settle, settled } = scene(onboardRun({ lineId: "code-review" }));

    await settle("code-review", "error");

    expect(settled).toEqual([]);
  });

  it("settles no task when the floor no longer has the run", async () => {
    const { settle, settled } = scene(null);

    await settle("onboard", "success");

    expect(settled).toEqual([]);
  });

  it("answers what the station it wraps answers", async () => {
    const { settle } = scene(onboardRun());

    expect(await settle("onboard", "success")).toEqual(NEXT);
  });
});
