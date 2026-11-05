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

  it("replaces run-1 and run-2 and cursor-2 with run-3 and a null cursor for page_loaded of run-3", () => {
    const state = initialRunList({
      runs: [run({ id: "run-1" }), run({ id: "run-2" })],
      nextCursor: "cursor-2",
    });

    const next = reduceRunList(state, {
      type: "page_loaded",
      runs: [run({ id: "run-3" })],
      nextCursor: null,
    });

    expect({
      ids: next.runs.map(({ id }) => id),
      nextCursor: next.nextCursor,
    }).toEqual({ ids: ["run-3"], nextCursor: null });
  });

  it("leaves run-1 and run-2 for a run_row of run-9, which is not on the page", () => {
    const state = initialRunList({
      runs: [run({ id: "run-1" }), run({ id: "run-2" })],
      nextCursor: "cursor-2",
    });

    const next = reduceRunList(state, {
      type: "run_row",
      run: run({ id: "run-9" }),
    });

    expect(next.runs.map(({ id }) => id)).toEqual(["run-1", "run-2"]);
  });

  it("sets the connection from connecting to live for a connection action of live", () => {
    const before = initialRunList({ runs: [], nextCursor: null });

    const after = reduceRunList(before, { type: "connection", state: "live" });

    expect({ before: before.connection, after: after.connection }).toEqual({
      before: "connecting",
      after: "live",
    });
  });

  it("keeps run-1's cost of 0.42 when a run_row of run-1 comes without one", () => {
    const state = initialRunList({
      runs: [run({ id: "run-1", costUsd: 0.42 })],
      nextCursor: null,
    });

    const next = reduceRunList(state, {
      type: "run_row",
      run: run({ id: "run-1", status: "finished", costUsd: null }),
    });

    expect(
      next.runs.map(({ status, costUsd }) => ({ status, costUsd })),
    ).toEqual([{ status: "finished", costUsd: 0.42 }]);
  });

  it("takes run-1's new cost of 1.5 over its old 0.42", () => {
    const state = initialRunList({
      runs: [run({ id: "run-1", costUsd: 0.42 })],
      nextCursor: null,
    });

    const next = reduceRunList(state, {
      type: "run_row",
      run: run({ id: "run-1", costUsd: 1.5 }),
    });

    expect(next.runs[0].costUsd).toBe(1.5);
  });

  it("keeps run-1's cost of 0.42 when a page read again lists run-1 without one", () => {
    const state = initialRunList({
      runs: [run({ id: "run-1", costUsd: 0.42 })],
      nextCursor: null,
    });

    const next = reduceRunList(state, {
      type: "page_loaded",
      runs: [run({ id: "run-1", costUsd: null }), run({ id: "run-2" })],
      nextCursor: null,
    });

    expect(next.runs.map(({ id, costUsd }) => ({ id, costUsd }))).toEqual([
      { id: "run-1", costUsd: 0.42 },
      { id: "run-2", costUsd: null },
    ]);
  });
});
