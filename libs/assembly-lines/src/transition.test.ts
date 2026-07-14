import { describe, it, expect, vi } from "vitest";
import { selectEdge, nextTransition, type NodeVisit } from "./transition.js";
import { parseAssemblyLine, type AssemblyLine } from "./loader.js";
import { loadBuiltinAssemblyLines } from "./builtin-assembly-lines.js";
import {
  executeAssemblyLine,
  type NodeHandlers,
  type NodeResult,
  type StageOutcome,
} from "./assembly-line-executor.js";
import type { LeaseBackend } from "@re-cinq/lore-shared";

const reviewLoop: AssemblyLine = parseAssemblyLine(`
name: review-loop
description: implement → validate → review → (changes → implement)
version: 1
entry: implement
exit: done
nodes:
  - id: implement
    type: agent
  - id: validate
    type: validate
  - id: review
    type: agent
  - id: done
    type: retrospective
edges:
  - from: implement
    to: validate
    on: success
  - from: validate
    to: review
    on: success
  - from: review
    to: done
    on: success
  - from: review
    to: implement
    on: changes_requested
    iteration_max: 2
`);

// implementation.yaml's shape: an ALWAYS back-edge carrying iteration_max.
const alwaysLoop: AssemblyLine = parseAssemblyLine(`
name: always-loop
description: address loops back to validate unconditionally, bounded
version: 1
entry: validate
exit: done
nodes:
  - id: validate
    type: validate
  - id: address
    type: agent
  - id: done
    type: retrospective
edges:
  - from: validate
    to: done
    on: success
  - from: validate
    to: address
    on: failed
  - from: address
    to: validate
    on: always
    iteration_max: 1
`);

const visit = (
  nodeId: string,
  iteration: number,
  outcome: StageOutcome | null,
): NodeVisit => ({ nodeId, iteration, outcome });

describe("selectEdge", () => {
  it("prefers the exact-outcome edge over always", () => {
    expect(selectEdge(alwaysLoop, "validate", "failed")?.to).toBe("address");
    expect(selectEdge(alwaysLoop, "address", "success")?.to).toBe("validate");
  });

  it("returns null when no edge matches the outcome", () => {
    expect(selectEdge(reviewLoop, "implement", "failed")).toBeNull();
  });
});

describe("nextTransition", () => {
  it("launches the entry node at iteration 1 on an empty history", () => {
    expect(nextTransition(reviewLoop, [])).toEqual({
      kind: "launch",
      nodeId: "implement",
      iteration: 1,
    });
  });

  it("awaits while the newest node row is still open", () => {
    expect(nextTransition(reviewLoop, [visit("implement", 1, null)])).toEqual({
      kind: "await",
    });
  });

  it("launches the next node after a success outcome", () => {
    expect(
      nextTransition(reviewLoop, [visit("implement", 1, "success")]),
    ).toEqual({ kind: "launch", nodeId: "validate", iteration: 1 });
  });

  it("routes changes_requested back to implement with a bumped iteration", () => {
    const visits = [
      visit("implement", 1, "success"),
      visit("validate", 1, "success"),
      visit("review", 1, "changes_requested"),
    ];

    expect(nextTransition(reviewLoop, visits)).toEqual({
      kind: "launch",
      nodeId: "implement",
      iteration: 2,
    });
  });

  it("finishes when the walk reaches the exit", () => {
    const visits = [
      visit("implement", 1, "success"),
      visit("validate", 1, "success"),
      visit("review", 1, "success"),
    ];

    expect(nextTransition(reviewLoop, visits)).toEqual({ kind: "finish" });
  });

  it("fails with iteration_max when a back-edge exceeds its budget", () => {
    const visits = [
      visit("implement", 1, "success"),
      visit("validate", 1, "success"),
      visit("review", 1, "changes_requested"),
      visit("implement", 2, "success"),
      visit("validate", 2, "success"),
      visit("review", 2, "changes_requested"),
      visit("implement", 3, "success"),
      visit("validate", 3, "success"),
      visit("review", 3, "changes_requested"),
    ];
    const t = nextTransition(reviewLoop, visits);

    expect(t).toMatchObject({ kind: "fail", outcome: "iteration_max" });
  });

  it("counts an always back-edge toward its iteration_max budget", () => {
    const visits = [
      visit("validate", 1, "failed"),
      visit("address", 1, "success"),
      visit("validate", 2, "failed"),
      visit("address", 2, "success"),
    ];
    const t = nextTransition(alwaysLoop, visits);

    expect(t).toMatchObject({ kind: "fail", outcome: "iteration_max" });
  });

  it("fails with a no-edge error when no edge matches the outcome", () => {
    const t = nextTransition(reviewLoop, [visit("implement", 1, "failed")]);

    expect(t).toMatchObject({ kind: "fail", outcome: "error" });
    expect((t as { reason: string }).reason).toContain(
      'no edge from "implement" for outcome "failed"',
    );
  });

  it("fails when the visit history exceeds maxNodes", () => {
    const visits = [visit("implement", 1, "success")];
    const t = nextTransition(reviewLoop, visits, 1);

    expect(t).toMatchObject({ kind: "fail", outcome: "error" });
  });
});

// ── Parity: the replay must route exactly as executeAssemblyLine does ──────
function noopBackend(): LeaseBackend {
  return {
    acquire: vi.fn(async () => ({ acquired: true })),
    refresh: vi.fn(async () => true),
    release: vi.fn(async () => true),
    reapExpired: vi.fn(async () => []),
  };
}

async function executorVisits(
  line: AssemblyLine,
  outcomes: Partial<Record<string, NodeResult>> = {},
) {
  const dispatch = async (node: { id: string }) =>
    outcomes[node.id] ?? { outcome: "success" as const };
  const handlers: NodeHandlers = {
    agent: dispatch,
    validate: dispatch,
    gate: dispatch,
    retrospective: dispatch,
    github_action: dispatch,
    detect: dispatch,
  };

  const summary = await executeAssemblyLine({
    assemblyLine: line,
    assemblyLineId: "al-parity",
    taskId: "task-parity",
    branchName: "branch-parity",
    gitDir: "/dev/null",
    holder: "test",
    leaseBackend: noopBackend(),
    handlers,
    gitCommit: async () => {},
  });

  return summary.visited;
}

function expectReplayParity(line: AssemblyLine, visited: NodeVisit[]) {
  for (let i = 0; i <= visited.length; i++) {
    const t = nextTransition(line, visited.slice(0, i));

    if (i < visited.length) {
      expect(t, `${line.name} step ${i}`).toEqual({
        kind: "launch",
        nodeId: visited[i].nodeId,
        iteration: visited[i].iteration,
      });
    } else {
      expect(t, `${line.name} terminal`).toEqual({ kind: "finish" });
    }
  }
}

describe("nextTransition replays the executor's routing exactly", () => {
  it("matches the all-success walk of every builtin assembly line", async () => {
    const builtins = await loadBuiltinAssemblyLines();

    expect(builtins.size).toBeGreaterThan(0);

    for (const line of builtins.values()) {
      const visited = await executorVisits(line);

      expectReplayParity(line, visited);
    }
  });

  it("matches a changes_requested review loop walk", async () => {
    // First review requests changes, second approves.
    let reviews = 0;
    const dispatchOutcomes: Partial<Record<string, () => NodeResult>> = {
      review: () =>
        reviews++ === 0
          ? { outcome: "changes_requested" }
          : { outcome: "success" },
    };
    const dispatch = async (node: { id: string }) =>
      dispatchOutcomes[node.id]?.() ?? { outcome: "success" as const };
    const handlers: NodeHandlers = {
      agent: dispatch,
      validate: dispatch,
      gate: dispatch,
      retrospective: dispatch,
    };
    const summary = await executeAssemblyLine({
      assemblyLine: reviewLoop,
      assemblyLineId: "al-parity-2",
      taskId: "task-parity-2",
      branchName: "branch-parity-2",
      gitDir: "/dev/null",
      holder: "test",
      leaseBackend: noopBackend(),
      handlers,
      gitCommit: async () => {},
    });

    expect(summary.visited.length).toBeGreaterThan(4);
    expectReplayParity(reviewLoop, summary.visited);
  });
});
