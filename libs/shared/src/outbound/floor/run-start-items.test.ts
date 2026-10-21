import { describe, expect, it } from "vitest";
import type { RunView } from "@re-cinq/floor-client";
import { startValueOf } from "./run-start-items.js";

const run = (startItems: RunView["startItems"]): RunView =>
  ({
    id: "run-1",
    lineId: "implementation-loop",
    lineHash: "hash-1",
    repo: "github.com/re-cinq/otto",
    subjectKey: "tickets",
    startItems,
    createdAt: "2026-10-21T00:00:00.000Z",
    outcome: null,
    reason: null,
    finishedAt: null,
  }) as RunView;

describe("startValueOf", () => {
  it("reads the task_id start item's ref", () => {
    const found = run({
      task_id: { kind: "value", ref: "task-158", by: "lore" },
    });

    expect(startValueOf(found, "task_id")).toBe("task-158");
  });

  it("is undefined for a start item the run does not carry", () => {
    expect(startValueOf(run({}), "task_id")).toBeUndefined();
  });
});
