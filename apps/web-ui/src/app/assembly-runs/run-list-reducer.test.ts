import { describe, expect, it } from "vitest";
import type { AssemblyRun } from "@/lib/assembly-run-rows";
import { initialRunList, reduceRunList } from "./run-list-reducer";

const run = (over: Partial<AssemblyRun>): AssemblyRun => ({
  id: "run-1",
  blueprintName: "code-review",
  graph: null,
  taskId: null,
  repo: "re-cinq/lore",
  branch: null,
  status: "running",
  outcome: null,
  reason: null,
  createdAt: "2026-10-02T09:00:00Z",
  startedAt: null,
  durationSeconds: null,
  prUrl: null,
  prNumber: null,
  issueUrl: null,
  issueNumber: null,
  createdBy: null,
  costUsd: null,
  ...over,
});

describe("reduceRunList", () => {
  it("replaces run-2 in place for a run_row of run-2 and leaves run-1 and the order", () => {
    const state = initialRunList({
      runs: [run({ id: "run-1" }), run({ id: "run-2" })],
      nextCursor: "cursor-2",
    });

    const next = reduceRunList(state, {
      type: "run_row",
      run: run({
        id: "run-2",
        status: "finished",
        outcome: "success",
        pipeline: [{ node_id: "review", state: "success" }],
      }),
    });

    expect(
      next.runs.map(({ id, status, pipeline }) => ({ id, status, pipeline })),
    ).toEqual([
      { id: "run-1", status: "running", pipeline: undefined },
      {
        id: "run-2",
        status: "finished",
        pipeline: [{ node_id: "review", state: "success" }],
      },
    ]);
  });
});
