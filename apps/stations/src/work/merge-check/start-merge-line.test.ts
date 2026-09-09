import { describe, it, expect } from "vitest";
import { startMergeLine } from "./start-merge-line.js";
import type { StartMergeLineDeps } from "./start-merge-line.js";

const TASK = { id: "t-1", target_repo: "o/r", pr_number: 7 };

function deps(over: Partial<StartMergeLineDeps> = {}): StartMergeLineDeps {
  return {
    findOpenBySubject: async () => null,
    countBySubject: async () => 0,
    start: async () => "run-1",
    ...over,
  };
}

describe("startMergeLine", () => {
  it("starts the merge line for the task whose PR merged", async () => {
    const started: Array<Record<string, unknown>> = [];

    await startMergeLine(
      TASK,
      deps({
        start: async (input) => {
          started.push(input as never);

          return "run-1";
        },
      }),
    );

    expect(started[0]).toMatchObject({
      blueprintName: "merge",
      taskId: "t-1",
      repo: "o/r",
    });
  });

  it("keys the run to the task, so a second sweep cannot start a second line", async () => {
    const started: Array<{ subjectKey?: string }> = [];

    await startMergeLine(
      TASK,
      deps({
        start: async (input) => {
          started.push(input as never);

          return "run-1";
        },
      }),
    );

    expect(started[0]?.subjectKey).toBe("merge:t-1");
  });

  it("starts nothing when a line for this task is already open", async () => {
    const started: unknown[] = [];

    const runId = await startMergeLine(
      TASK,
      deps({
        findOpenBySubject: async () => ({ id: "already" }),
        start: async (input) => {
          started.push(input);

          return "run-2";
        },
      }),
    );

    expect(started).toEqual([]);
    expect(runId).toBeNull();
  });

  it("starts nothing after 3 finished lines for this task, so a failing settle cannot loop forever", async () => {
    const started: unknown[] = [];

    const runId = await startMergeLine(
      TASK,
      deps({
        countBySubject: async () => 3,
        start: async (input) => {
          started.push(input);

          return "run-4";
        },
      }),
    );

    expect(started).toEqual([]);
    expect(runId).toBeNull();
  });

  it("starts a retry while only 2 lines have finished for this task", async () => {
    const runId = await startMergeLine(
      TASK,
      deps({ countBySubject: async () => 2 }),
    );

    expect(runId).toBe("run-1");
  });
});
