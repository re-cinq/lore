import { describe, expect, it } from "vitest";
import { recordedFloor } from "@re-cinq/lore-shared/floor/recorded-floor.js";
import {
  FLOOR_LINE,
  FLOOR_RUN,
} from "../../../work/floor/floor-run.fixtures.js";
import { handleRunNode } from "./run-node.js";

const ANSWERS: Record<string, unknown> = {
  "/assembly-runs/run-1": { run: FLOOR_RUN, bag: {} },
  "/assembly-lines/code-review/versions/hash-1": { body: FLOOR_LINE },
  "/events": { id: "event-1" },
  "/events/event-1": { id: "event-1", ackedAt: "2026-10-06T10:00:01.000Z" },
};

describe("handleRunNode", () => {
  it("answers run_id run-1, not pending, once the floor takes the review node's start", async () => {
    const { floor } = recordedFloor((request) => ANSWERS[request.path]);
    const answer = await handleRunNode(
      floor,
      { runId: "run-1", nodeId: "review", actor: "gedaiu" },
      { pollMs: 250, budgetMs: 250, sleep: () => Promise.resolve() },
    );

    expect(answer).toEqual({ run_id: "run-1", pending: false });
  });
});
