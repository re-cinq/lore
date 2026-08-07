import { describe, it, expect } from "vitest";
import { selectEdge, nextTransition, type NodeVisit } from "./transition.js";
import { parseAssemblyLine, type AssemblyLine } from "./loader.js";
import { loadBuiltinAssemblyLines } from "./builtin-assembly-lines.js";
import type { StageOutcome } from "./node-types.js";

// Handcrafted rather than parseAssemblyLine: implement and validate
// deliberately lack failed / changes_requested edges so the runtime
// no-edge guard below stays exercisable — the loader now rejects a
// definition whose producible outcomes are uncovered (#946), keeping
// `nextTransition`'s no-edge failure as defense-in-depth for graphs
// that never went through the loader.
const reviewLoop: AssemblyLine = {
  name: "review-loop",
  description: "implement → validate → review → (changes → implement)",
  version: 1,
  entry: "implement",
  exit: "done",
  nodes: [
    { id: "implement", type: "agent" },
    { id: "validate", type: "validate" },
    { id: "review", type: "agent" },
    { id: "done", type: "retrospective" },
  ],
  edges: [
    { from: "implement", to: "validate", on: "success" },
    { from: "validate", to: "review", on: "success" },
    { from: "review", to: "done", on: "success" },
    {
      from: "review",
      to: "implement",
      on: "changes_requested",
      iteration_max: 2,
    },
  ],
};

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

  it("fails when a recorded node's iteration diverges from the recomputed walk", () => {
    // implement@1 succeeded, but the next row was persisted as validate@2 (wrong
    // iteration) — must fail loudly, not replay a split-brain iteration.
    const visits = [
      visit("implement", 1, "success"),
      visit("validate", 2, "success"),
    ];
    const t = nextTransition(reviewLoop, visits);

    expect(t).toMatchObject({ kind: "fail", outcome: "error" });
    expect((t as { reason: string }).reason).toContain("diverge");
  });
});

// The executor parity oracle retired with the in-process walk (its extraction-time
// parity run covered every builtin YAML). This keeps a live guarantee: an
// all-success walk of every builtin definition routes node-by-node to finish.
describe("nextTransition walks every builtin assembly line to finish on success", () => {
  it("routes each builtin definition's success path to the exit", async () => {
    const builtins = await loadBuiltinAssemblyLines();

    expect(builtins.size).toBeGreaterThan(0);

    for (const line of builtins.values()) {
      const visits: NodeVisit[] = [];

      for (let step = 0; step < 50; step++) {
        const t = nextTransition(line, visits);

        if (t.kind === "finish") {
          break;
        }
        expect(t.kind, `${line.name} step ${step}`).toBe("launch");

        if (t.kind === "launch") {
          visits.push({
            nodeId: t.nodeId,
            iteration: t.iteration,
            outcome: "success",
          });
        }
      }
      expect(nextTransition(line, visits), line.name).toEqual({
        kind: "finish",
      });
    }
  });
});

// A gated review with a bypass edge: `work` can route straight to `done` on
// changes_requested, skipping the goal-gated review entirely.
const gatedReview: AssemblyLine = {
  name: "gated-review",
  description: "work → review (goal-gated) → done, with a review bypass",
  version: 1,
  entry: "work",
  exit: "done",
  nodes: [
    { id: "work", type: "agent" },
    { id: "review", type: "agent", goal_gate: true },
    { id: "done", type: "retrospective" },
  ],
  edges: [
    { from: "work", to: "review", on: "success" },
    { from: "work", to: "done", on: "changes_requested" },
    { from: "review", to: "done", on: "success" },
    { from: "review", to: "done", on: "changes_requested" },
    { from: "review", to: "done", on: "failed" },
  ],
};

describe("nextTransition goal gates", () => {
  it("fails with goal_gate_unmet naming the gate when the walk finishes around a goal-gated node", () => {
    const visits: NodeVisit[] = [
      { nodeId: "work", iteration: 1, outcome: "changes_requested" },
    ];

    const t = nextTransition(gatedReview, visits);

    expect(t).toMatchObject({ kind: "fail", outcome: "goal_gate_unmet" });
    expect(t.kind === "fail" && t.reason).toContain('"review"');
  });

  it("fails with goal_gate_unmet when the goal-gated node's only outcome is failed", () => {
    const visits: NodeVisit[] = [
      { nodeId: "work", iteration: 1, outcome: "success" },
      { nodeId: "review", iteration: 1, outcome: "failed" },
    ];

    expect(nextTransition(gatedReview, visits)).toMatchObject({
      kind: "fail",
      outcome: "goal_gate_unmet",
    });
  });

  it("finishes when the goal-gated node recorded success", () => {
    const visits: NodeVisit[] = [
      { nodeId: "work", iteration: 1, outcome: "success" },
      { nodeId: "review", iteration: 1, outcome: "success" },
    ];

    expect(nextTransition(gatedReview, visits)).toEqual({ kind: "finish" });
  });

  it("treats changes_requested as satisfying a goal gate", () => {
    const visits: NodeVisit[] = [
      { nodeId: "work", iteration: 1, outcome: "success" },
      { nodeId: "review", iteration: 1, outcome: "changes_requested" },
    ];

    expect(nextTransition(gatedReview, visits)).toEqual({ kind: "finish" });
  });

  it("lists every unsatisfied gate in the goal_gate_unmet reason", () => {
    const twoGates: AssemblyLine = {
      name: "two-gates",
      description: "work → lint → review → done, both gated, one bypass",
      version: 1,
      entry: "work",
      exit: "done",
      nodes: [
        { id: "work", type: "agent" },
        { id: "lint", type: "validate", goal_gate: true },
        { id: "review", type: "agent", goal_gate: true },
        { id: "done", type: "retrospective" },
      ],
      edges: [
        { from: "work", to: "lint", on: "success" },
        { from: "work", to: "done", on: "changes_requested" },
        { from: "lint", to: "review", on: "success" },
        { from: "review", to: "done", on: "success" },
      ],
    };
    const visits: NodeVisit[] = [
      { nodeId: "work", iteration: 1, outcome: "changes_requested" },
    ];

    const t = nextTransition(twoGates, visits);

    expect(t).toMatchObject({ kind: "fail", outcome: "goal_gate_unmet" });
    expect(t.kind === "fail" && t.reason).toContain('"lint"');
    expect(t.kind === "fail" && t.reason).toContain('"review"');
  });
});

// Gated review whose changes_requested loops back to work while failed
// routes to done — the shape where a stale iter-1 verdict could mask a
// failed final review.
const gatedCrLoop: AssemblyLine = {
  name: "gated-cr-loop",
  description: "review loops on changes_requested, exits on failed/success",
  version: 1,
  entry: "work",
  exit: "done",
  nodes: [
    { id: "work", type: "agent" },
    { id: "review", type: "agent", goal_gate: true },
    { id: "done", type: "retrospective" },
  ],
  edges: [
    { from: "work", to: "review", on: "success" },
    { from: "work", to: "done", on: "changes_requested" },
    { from: "review", to: "work", on: "changes_requested", iteration_max: 2 },
    { from: "review", to: "done", on: "failed" },
    { from: "review", to: "done", on: "success" },
  ],
};

// The mirror shape: failed loops back to work, so a later clean run can
// supersede an earlier failed visit.
const gatedRetryLoop: AssemblyLine = {
  name: "gated-retry-loop",
  description: "review loops on failed, exits on success/changes_requested",
  version: 1,
  entry: "work",
  exit: "done",
  nodes: [
    { id: "work", type: "agent" },
    { id: "review", type: "agent", goal_gate: true },
    { id: "done", type: "retrospective" },
  ],
  edges: [
    { from: "work", to: "review", on: "success" },
    { from: "work", to: "done", on: "changes_requested" },
    { from: "review", to: "work", on: "failed", iteration_max: 2 },
    { from: "review", to: "done", on: "changes_requested" },
    { from: "review", to: "done", on: "success" },
  ],
};

describe("nextTransition goal gates across iterations", () => {
  it("fails goal_gate_unmet when the gate was satisfied on iteration 1 but its latest visit failed", () => {
    const visits: NodeVisit[] = [
      { nodeId: "work", iteration: 1, outcome: "success" },
      { nodeId: "review", iteration: 1, outcome: "changes_requested" },
      { nodeId: "work", iteration: 2, outcome: "success" },
      { nodeId: "review", iteration: 2, outcome: "failed" },
    ];

    expect(nextTransition(gatedCrLoop, visits)).toMatchObject({
      kind: "fail",
      outcome: "goal_gate_unmet",
    });
  });

  it("finishes when the gate's latest visit succeeds after an earlier failed one", () => {
    const visits: NodeVisit[] = [
      { nodeId: "work", iteration: 1, outcome: "success" },
      { nodeId: "review", iteration: 1, outcome: "failed" },
      { nodeId: "work", iteration: 2, outcome: "success" },
      { nodeId: "review", iteration: 2, outcome: "success" },
    ];

    expect(nextTransition(gatedRetryLoop, visits)).toEqual({
      kind: "finish",
    });
  });
});
