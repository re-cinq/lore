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

describe("rework: a step sends work back to the step that fed it", () => {
  it("routes write's objection back to analyse, then fails rather than looping", async () => {
    // The whole point of bounding rework: analyse gets ONE correction. A second
    // objection has to end the line, or two agents disagreeing spend the day at it.
    const finalize = (await loadBuiltinAssemblyLines()).get("feature-finalize");

    expect(finalize).toBeDefined();
    const visits: NodeVisit[] = [
      { nodeId: "analyse", iteration: 1, outcome: "success" },
      { nodeId: "write", iteration: 1, outcome: "changes_requested" },
    ];

    expect(nextTransition(finalize!, visits)).toMatchObject({
      kind: "launch",
      nodeId: "analyse",
      iteration: 2,
    });

    visits.push(
      { nodeId: "analyse", iteration: 2, outcome: "success" },
      { nodeId: "write", iteration: 2, outcome: "changes_requested" },
    );

    expect(nextTransition(finalize!, visits).kind).toBe("fail");
  });

  it("routes the station's objection back to decompose, then fails rather than looping", async () => {
    // The decompose/issues pair is the TAIL of feature-planning now, not its own
    // line — the objection loop is unchanged, only its home is.
    const decompose = (await loadBuiltinAssemblyLines()).get(
      "feature-planning",
    );

    expect(decompose).toBeDefined();
    const visits: NodeVisit[] = [
      { nodeId: "analyze", iteration: 1, outcome: "success" },
      { nodeId: "author", iteration: 1, outcome: "success" },
      { nodeId: "analyse-specs", iteration: 1, outcome: "success" },
      { nodeId: "write", iteration: 1, outcome: "success" },
      { nodeId: "push", iteration: 1, outcome: "success" },
      { nodeId: "merged", iteration: 1, outcome: "success" },
      { nodeId: "decompose", iteration: 1, outcome: "success" },
      { nodeId: "issues", iteration: 1, outcome: "changes_requested" },
    ];

    expect(nextTransition(decompose!, visits)).toMatchObject({
      kind: "launch",
      nodeId: "decompose",
      iteration: 2,
    });

    visits.push(
      { nodeId: "decompose", iteration: 2, outcome: "success" },
      { nodeId: "issues", iteration: 2, outcome: "changes_requested" },
    );

    expect(nextTransition(decompose!, visits).kind).toBe("fail");
  });

  it("ends the line when analyse asks the AUTHOR for changes", async () => {
    // No upstream node to loop to — the input is the plan a human accepted, so the
    // walk routes straight to the exit. Returning the feature to the author is the
    // settlement's job, not the graph's.
    const finalize = (await loadBuiltinAssemblyLines()).get("feature-finalize");

    expect(
      nextTransition(finalize!, [
        { nodeId: "analyse", iteration: 1, outcome: "changes_requested" },
      ]),
    ).toEqual({ kind: "finish" });
  });
});

// A gated review whose own failed/changes_requested edges reach the exit, so the
// walk can arrive at `done` with the gate unsatisfied — the shape the finish
// guard exists for. work's non-success edges skip the gate entirely.
const gatedReview: AssemblyLine = parseAssemblyLine(`
name: gated-review
description: review is a goal gate; work's non-success outcomes route around it
version: 1
entry: work
exit: done
nodes:
  - id: work
    type: agent
  - id: review
    type: agent
    goal_gate: true
  - id: done
    type: retrospective
edges:
  - from: work
    to: review
    on: success
  - from: work
    to: done
    on: changes_requested
  - from: work
    to: done
    on: failed
  - from: review
    to: done
    on: always
`);

describe("nextTransition — goal gates", () => {
  it("finishes when the gated node succeeded", () => {
    const visits = [visit("work", 1, "success"), visit("review", 1, "success")];

    expect(nextTransition(gatedReview, visits)).toEqual({ kind: "finish" });
  });

  it("fails goal_gate_unmet when the gated node failed", () => {
    const visits = [visit("work", 1, "success"), visit("review", 1, "failed")];

    expect(nextTransition(gatedReview, visits)).toMatchObject({
      kind: "fail",
      outcome: "goal_gate_unmet",
    });
  });

  it("fails goal_gate_unmet when branching skipped the gated node entirely", () => {
    expect(
      nextTransition(gatedReview, [visit("work", 1, "failed")]),
    ).toMatchObject({
      kind: "fail",
      outcome: "goal_gate_unmet",
    });
  });

  it("finishes when the gated node requested changes", () => {
    const visits = [
      visit("work", 1, "success"),
      visit("review", 1, "changes_requested"),
    ];

    expect(nextTransition(gatedReview, visits)).toEqual({ kind: "finish" });
  });

  it("finishes an ungated line whose nodes recorded non-success outcomes", () => {
    const visits = [
      visit("validate", 1, "failed"),
      visit("address", 1, "success"),
      visit("validate", 2, "success"),
    ];

    expect(nextTransition(alwaysLoop, visits)).toEqual({ kind: "finish" });
  });
});

// The gated node is revisitable from both sides: changes_requested loops back
// through work, and a failed verify sends the line back into review. Both a
// stale pass and a stale rejection therefore sit in the history.
const gatedLoop: AssemblyLine = parseAssemblyLine(`
name: gated-loop
description: review is a goal gate the walk can revisit from either side
version: 1
entry: work
exit: done
nodes:
  - id: work
    type: agent
  - id: review
    type: agent
    goal_gate: true
  - id: verify
    type: validate
  - id: done
    type: retrospective
edges:
  - from: work
    to: review
    on: always
  - from: review
    to: verify
    on: success
  - from: review
    to: work
    on: changes_requested
    iteration_max: 2
  - from: review
    to: done
    on: failed
  - from: verify
    to: done
    on: success
  - from: verify
    to: review
    on: failed
    iteration_max: 2
`);

describe("nextTransition — goal gates read the latest visit", () => {
  it("finishes when a re-run supersedes an earlier changes_requested", () => {
    const visits = [
      visit("work", 1, "success"),
      visit("review", 1, "changes_requested"),
      visit("work", 2, "success"),
      visit("review", 2, "success"),
      visit("verify", 2, "success"),
    ];

    expect(nextTransition(gatedLoop, visits)).toEqual({ kind: "finish" });
  });

  it("fails goal_gate_unmet when a re-run supersedes an earlier success", () => {
    const visits = [
      visit("work", 1, "success"),
      visit("review", 1, "success"),
      visit("verify", 1, "failed"),
      visit("review", 2, "failed"),
    ];

    expect(nextTransition(gatedLoop, visits)).toMatchObject({
      kind: "fail",
      outcome: "goal_gate_unmet",
    });
  });
});

// Two gates, both skipped by the same failed edge — the diagnostic has to name
// each one, not just report that some gate was unmet.
const twoGates: AssemblyLine = parseAssemblyLine(`
name: two-gates
description: review and audit are both goal gates work's failed edge routes around
version: 1
entry: work
exit: done
nodes:
  - id: work
    type: agent
  - id: review
    type: agent
    goal_gate: true
  - id: audit
    type: agent
    goal_gate: true
  - id: done
    type: retrospective
edges:
  - from: work
    to: review
    on: success
  - from: work
    to: done
    on: changes_requested
  - from: work
    to: done
    on: failed
  - from: review
    to: audit
    on: always
  - from: audit
    to: done
    on: always
`);

describe("nextTransition — goal_gate_unmet diagnostic", () => {
  it("names every unsatisfied gate in the failure reason", () => {
    expect(
      nextTransition(twoGates, [visit("work", 1, "failed")]),
    ).toMatchObject({
      kind: "fail",
      outcome: "goal_gate_unmet",
      reason: expect.stringContaining(
        'unsatisfied goal gate(s) "review", "audit"',
      ),
    });
  });
});

// A gated line whose retry budget runs out before the gate is ever reached.
const gatedWithLoop: AssemblyLine = parseAssemblyLine(`
name: gated-with-loop
description: work retries itself once; review is a goal gate reached only on success
version: 1
entry: work
exit: done
nodes:
  - id: work
    type: agent
  - id: review
    type: agent
    goal_gate: true
  - id: done
    type: retrospective
edges:
  - from: work
    to: review
    on: success
  - from: work
    to: work
    on: failed
    iteration_max: 1
  - from: work
    to: done
    on: changes_requested
  - from: review
    to: done
    on: always
`);

describe("nextTransition — goal gates versus the loop budget", () => {
  it("fails iteration_max when the retry budget runs out before the gate", () => {
    const visits = [visit("work", 1, "failed"), visit("work", 2, "failed")];

    expect(nextTransition(gatedWithLoop, visits)).toMatchObject({
      kind: "fail",
      outcome: "iteration_max",
    });
  });
});
