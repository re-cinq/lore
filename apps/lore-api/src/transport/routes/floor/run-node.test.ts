import { describe, expect, it, vi } from "vitest";
import { recordedFloor } from "@re-cinq/lore-shared/floor/recorded-floor.js";
import {
  FLOOR_LINE,
  FLOOR_RUN,
  FLOOR_RUN_LOOP,
} from "../../../work/floor/floor-run.fixtures.js";
import { handleRunNode } from "./run-node.js";

const ANSWERS: Record<string, unknown> = {
  "/assembly-runs/run-1": { run: FLOOR_RUN, bag: {} },
  "/assembly-lines/code-review/versions/hash-1": { body: FLOOR_LINE },
  "/assembly-lines/implementation-loop/versions/hash-1": { body: FLOOR_LINE },
  "/events": { id: "event-1" },
  "/events/event-1": { id: "event-1", ackedAt: "2026-10-06T10:00:01.000Z" },
};

function fakePool() {
  return { query: vi.fn().mockResolvedValue({ rows: [] }) };
}

describe("handleRunNode", () => {
  it("answers run_id run-1, not pending, once the floor takes the review node's start", async () => {
    const { floor } = recordedFloor((request) => ANSWERS[request.path]);
    const pool = fakePool();
    const answer = await handleRunNode(
      floor,
      pool as never,
      { runId: "run-1", nodeId: "review", actor: "gedaiu" },
      { pollMs: 250, budgetMs: 250, sleep: () => Promise.resolve() },
    );

    expect(answer).toEqual({ run_id: "run-1", pending: false });
  });

  it("touches no pipeline.tasks row for a code-review run (no task_id to revive)", async () => {
    const { floor } = recordedFloor((request) => ANSWERS[request.path]);
    const pool = fakePool();

    await handleRunNode(
      floor,
      pool as never,
      { runId: "run-1", nodeId: "review", actor: "gedaiu" },
      { pollMs: 250, budgetMs: 250, sleep: () => Promise.resolve() },
    );

    expect(pool.query).not.toHaveBeenCalled();
  });

  it("revives the task to running when a loop run carrying a task_id is started by hand", async () => {
    const answers: Record<string, unknown> = {
      ...ANSWERS,
      "/assembly-runs/run-1": { run: FLOOR_RUN_LOOP, bag: {} },
    };
    const { floor } = recordedFloor((request) => answers[request.path]);
    const pool = fakePool();

    await handleRunNode(
      floor,
      pool as never,
      { runId: "run-1", nodeId: "review", actor: "gedaiu" },
      { pollMs: 250, budgetMs: 250, sleep: () => Promise.resolve() },
    );

    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE pipeline.tasks"),
      ["task-158"],
    );
  });

  it("touches no pipeline.tasks row for a loop run with no task_id start item", async () => {
    const noTaskId = {
      ...FLOOR_RUN_LOOP,
      startItems: { repo: FLOOR_RUN_LOOP.startItems.repo },
    };
    const answers: Record<string, unknown> = {
      ...ANSWERS,
      "/assembly-runs/run-1": { run: noTaskId, bag: {} },
    };
    const { floor } = recordedFloor((request) => answers[request.path]);
    const pool = fakePool();

    await handleRunNode(
      floor,
      pool as never,
      { runId: "run-1", nodeId: "review", actor: "gedaiu" },
      { pollMs: 250, budgetMs: 250, sleep: () => Promise.resolve() },
    );

    expect(pool.query).not.toHaveBeenCalled();
  });
});
