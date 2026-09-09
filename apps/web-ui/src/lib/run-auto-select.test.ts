import { describe, it, expect } from "vitest";
import type { AssemblyRunNode } from "./assembly-run-rows";
import { implementationDefinition } from "./definition-fixtures";
import type { NodeRunState } from "./run-event-reducer";
import { autoSelectNodeId, effectiveSelection } from "./run-auto-select";

const state = (
  status: NodeRunState["status"],
  iteration = 1,
): NodeRunState => ({ status, iteration, transcript: [], droppedCount: 0 });

const row = (nodeId: string, startedAt: string): AssemblyRunNode => ({
  nodeId,
  iteration: 1,
  outcome: "success",
  agentCrName: null,
  commitSha: null,
  durationSeconds: 10,
  startedAt,
});

const rows = (...entries: AssemblyRunNode[]) =>
  new Map(entries.map((entry) => [entry.nodeId, entry]));

describe("autoSelectNodeId", () => {
  it("picks the running node over a failed and a finished one", () => {
    const picked = autoSelectNodeId(
      implementationDefinition,
      {
        implement: state("succeeded"),
        validate: state("failed"),
        done: state("running"),
      },
      rows(),
    );

    expect(picked).toBe("done");
  });

  it("picks the first failed node in definition order when nothing runs", () => {
    const picked = autoSelectNodeId(
      implementationDefinition,
      { implement: state("failed"), validate: state("failed") },
      rows(),
    );

    expect(picked).toBe("implement");
  });

  it("picks the finished node whose visit began last, and definition order on a tie", () => {
    const states = {
      implement: state("succeeded"),
      validate: state("succeeded"),
    };

    expect(
      autoSelectNodeId(
        implementationDefinition,
        states,
        rows(
          row("implement", "2026-09-09T10:05:00Z"),
          row("validate", "2026-09-09T10:01:00Z"),
        ),
      ),
    ).toBe("implement");
    expect(autoSelectNodeId(implementationDefinition, states, rows())).toBe(
      "implement",
    );
  });

  it("picks nothing for a run where every node is idle", () => {
    expect(
      autoSelectNodeId(
        implementationDefinition,
        { implement: state("idle"), validate: state("idle") },
        rows(),
      ),
    ).toBeNull();
  });
});

describe("effectiveSelection", () => {
  it("keeps the user's pick while the graph still has that node, else takes the automatic one", () => {
    const known = new Set(["implement", "validate"]);

    expect(effectiveSelection("validate", "implement", known)).toBe("validate");
    expect(effectiveSelection("vanished", "implement", known)).toBe(
      "implement",
    );
    expect(effectiveSelection(null, null, known)).toBeNull();
  });
});
