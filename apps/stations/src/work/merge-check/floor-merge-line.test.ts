import { describe, expect, it } from "vitest";
import {
  floorMergeLinePorts,
  type MergeLineFloor,
} from "./floor-merge-line.js";
import { startMergeLine } from "./start-merge-line.js";

interface FloorRun {
  id: string;
  finishedAt: string | null;
}

function floorWith(runs: FloorRun[]) {
  const listed: unknown[] = [];
  const started: unknown[] = [];
  const floor = {
    runs: {
      list: (filter: unknown) => {
        listed.push(filter);

        return Promise.resolve({ items: runs });
      },
    },
    lines: {
      start: (line: string, starting: unknown) => {
        started.push({ line, starting });

        return Promise.resolve({ run: { id: "run-new" }, joined: false });
      },
    },
  } as unknown as MergeLineFloor;

  return { floor, listed, started };
}

const TASK = { id: "t-1", target_repo: "Re-Cinq/Lore", pr_number: 7 };

describe("starting the merge line on the floor", () => {
  it("starts line merge for task t-1 on github.com/re-cinq/lore with task_id t-1", async () => {
    const { floor, started } = floorWith([]);
    const runId = await startMergeLine(TASK, floorMergeLinePorts(floor));

    expect(runId).toBe("run-new");
    expect(started).toEqual([
      {
        line: "merge",
        starting: {
          repo: "github.com/re-cinq/lore",
          startItems: { task_id: { kind: "value", ref: "t-1", by: "lore" } },
        },
      },
    ]);
  });

  it("asks the floor for the runs of line merge with subject task_id:t-1", async () => {
    const { floor, listed } = floorWith([]);

    await startMergeLine(TASK, floorMergeLinePorts(floor));

    expect(listed[0]).toEqual({
      repo: "github.com/re-cinq/lore",
      line: "merge",
      subject: "task_id:t-1",
    });
  });

  it("starts nothing while a merge run for task t-1 is still open", async () => {
    const { floor, started } = floorWith([{ id: "run-1", finishedAt: null }]);
    const runId = await startMergeLine(TASK, floorMergeLinePorts(floor));

    expect(runId).toBeNull();
    expect(started).toEqual([]);
  });

  it("starts nothing once task t-1 has 3 settled merge runs", async () => {
    const settled = ["run-1", "run-2", "run-3"].map((id) => ({
      id,
      finishedAt: "2026-10-01T12:00:00Z",
    }));
    const { floor, started } = floorWith(settled);
    const runId = await startMergeLine(TASK, floorMergeLinePorts(floor));

    expect(runId).toBeNull();
    expect(started).toEqual([]);
  });

  it("starts a third run when task t-1 has 2 settled merge runs", async () => {
    const settled = ["run-1", "run-2"].map((id) => ({
      id,
      finishedAt: "2026-10-01T12:00:00Z",
    }));
    const { floor } = floorWith(settled);

    expect(await startMergeLine(TASK, floorMergeLinePorts(floor))).toBe(
      "run-new",
    );
  });
});
