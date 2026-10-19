import { describe, it, expect } from "vitest";
import type { AssemblyRunNode } from "./assembly-run-rows";
import { effectiveAttempt } from "./run-attempt-select";

const row = (nodeId: string, iteration: number): AssemblyRunNode => ({
  nodeId,
  iteration,
  outcome: null,
  agentCrName: null,
  commitSha: null,
  durationSeconds: null,
});

const rows = [row("implement", 1), row("implement", 3), row("implement", 2)];

describe("effectiveAttempt", () => {
  it("picks iteration 3, the highest, when nothing was picked", () => {
    expect(effectiveAttempt(null, "implement", rows)).toEqual(
      row("implement", 3),
    );
  });

  it("keeps a pick of iteration 1 on implement while that row exists", () => {
    expect(
      effectiveAttempt(
        { nodeId: "implement", iteration: 1 },
        "implement",
        rows,
      ),
    ).toEqual(row("implement", 1));
  });

  it("ignores a pick made on review when implement is selected", () => {
    expect(
      effectiveAttempt({ nodeId: "review", iteration: 1 }, "implement", rows),
    ).toEqual(row("implement", 3));
  });

  it("falls back to the highest iteration when the picked one is gone", () => {
    expect(
      effectiveAttempt(
        { nodeId: "implement", iteration: 9 },
        "implement",
        rows,
      ),
    ).toEqual(row("implement", 3));
  });

  it("returns null for a node with no rows", () => {
    expect(effectiveAttempt(null, "implement", [])).toBeNull();
  });
});
