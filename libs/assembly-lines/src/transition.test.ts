import { describe, it, expect } from "vitest";
import { selectEdge, getNextTransition, type NodeVisit } from "./transition.js";
import { parseAssemblyLine, type AssemblyLine } from "./loader.js";
import { loadBuiltinAssemblyLines } from "./builtin-assembly-lines.js";
import type { StageOutcome } from "./node-types.js";

// Handcrafted rather than parseAssemblyLine: implement and validate
// deliberately lack failed / changes_requested edges so the runtime
// no-edge guard below stays exercisable — the loader now rejects a
// definition whose producible outcomes are uncovered (#946), keeping
// `getNextTransition`'s no-edge failure as defense-in-depth for graphs
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

// feature-planning.yaml's shape: a node that retries ITSELF once on failure.
const selfRetry: AssemblyLine = parseAssemblyLine(`
name: feature-planning
description: analyze retries itself once, then the author reads the round
version: 1
entry: analyze
exit: done
nodes:
  - id: analyze
    type: agent
  - id: done
    type: retrospective
edges:
  - from: analyze
    to: done
    on: success
  - from: analyze
    to: done
    on: changes_requested
  - from: analyze
    to: analyze
    on: failed
    iteration_max: 1
`);

// A line whose `failed` edge routes FORWARD, to the retrospective every
// definition runs on its way out. Suppressing a permanent failure's RETRY must
// not suppress its ROUTE, or the line silently skips that work.
const forwardOnFailed: AssemblyLine = parseAssemblyLine(`
name: forward-on-failed
description: review fails forward into the retrospective
version: 1
entry: review
exit: done
nodes:
  - id: review
    type: agent
  - id: retro
    type: retrospective
  - id: done
    type: retrospective
edges:
  - from: review
    to: done
    on: success
  - from: review
    to: done
    on: changes_requested
  - from: review
    to: retro
    on: failed
  - from: retro
    to: done
    on: always
`);

describe("selectEdge", () => {
  it("prefers the exact-outcome edge over always", () => {
    expect(selectEdge(alwaysLoop, "validate", "failed")?.to).toBe("address");
    expect(selectEdge(alwaysLoop, "address", "success")?.to).toBe("validate");
  });

  it("returns null when no edge matches the outcome", () => {
    expect(selectEdge(reviewLoop, "implement", "failed")).toBeNull();
  });
});

describe("getNextTransition on a permanent node failure", () => {
  it("does not retry a node the account has no credit to run", () => {
    expect(
      getNextTransition(selfRetry, [
        {
          nodeId: "analyze",
          iteration: 1,
          outcome: "failed",
          failureClass: "anthropic-credit",
          failureDetail: "Credit balance is too low",
        },
      ]),
    ).toMatchObject({ kind: "fail", outcome: "error" });
  });

  it("names the cause rather than the edge budget it declined to spend", () => {
    const transition = getNextTransition(selfRetry, [
      {
        nodeId: "analyze",
        iteration: 1,
        outcome: "failed",
        failureClass: "anthropic-credit",
        failureDetail: "Credit balance is too low",
      },
    ]);

    expect(transition.kind === "fail" && transition.reason).toContain(
      "Credit balance is too low",
    );
    expect(transition.kind === "fail" && transition.reason).not.toContain(
      "iteration_max",
    );
  });

  it("still retries a rate limit, which a later attempt can clear", () => {
    expect(
      getNextTransition(selfRetry, [
        {
          nodeId: "analyze",
          iteration: 1,
          outcome: "failed",
          failureClass: "anthropic-rate-limit",
          failureDetail: "429 rate limit exceeded",
        },
      ]),
    ).toEqual({ kind: "launch", nodeId: "analyze", iteration: 2 });
  });

  it("still retries an unclassified failure, which is what the budget is for", () => {
    expect(
      getNextTransition(selfRetry, [visit("analyze", 1, "failed")]),
    ).toEqual({
      kind: "launch",
      nodeId: "analyze",
      iteration: 2,
    });
  });

  it("still ROUTES a permanent failure forward when the edge is not a retry", () => {
    expect(
      getNextTransition(forwardOnFailed, [
        {
          nodeId: "review",
          iteration: 1,
          outcome: "failed",
          failureClass: "anthropic-credit",
          failureDetail: "Credit balance is too low",
        },
      ]),
    ).toEqual({ kind: "launch", nodeId: "retro", iteration: 1 });
  });
});

describe("getNextTransition", () => {
  it("launches the entry node at iteration 1 on an empty history", () => {
    expect(getNextTransition(reviewLoop, [])).toEqual({
      kind: "launch",
      nodeId: "implement",
      iteration: 1,
    });
  });

  it("awaits while the newest node row is still open", () => {
    expect(
      getNextTransition(reviewLoop, [visit("implement", 1, null)]),
    ).toEqual({
      kind: "await",
    });
  });

  it("launches the next node after a success outcome", () => {
    expect(
      getNextTransition(reviewLoop, [visit("implement", 1, "success")]),
    ).toEqual({ kind: "launch", nodeId: "validate", iteration: 1 });
  });

  it("routes changes_requested back to implement with a bumped iteration", () => {
    const visits = [
      visit("implement", 1, "success"),
      visit("validate", 1, "success"),
      visit("review", 1, "changes_requested"),
    ];

    expect(getNextTransition(reviewLoop, visits)).toEqual({
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

    expect(getNextTransition(reviewLoop, visits)).toEqual({ kind: "finish" });
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
    const t = getNextTransition(reviewLoop, visits);

    expect(t).toMatchObject({ kind: "fail", outcome: "iteration_max" });
  });

  it("counts an always back-edge toward its iteration_max budget", () => {
    const visits = [
      visit("validate", 1, "failed"),
      visit("address", 1, "success"),
      visit("validate", 2, "failed"),
      visit("address", 2, "success"),
    ];
    const t = getNextTransition(alwaysLoop, visits);

    expect(t).toMatchObject({ kind: "fail", outcome: "iteration_max" });
  });

  it("fails with a no-edge error when no edge matches the outcome", () => {
    const t = getNextTransition(reviewLoop, [visit("implement", 1, "failed")]);

    expect(t).toMatchObject({ kind: "fail", outcome: "error" });
    expect((t as { reason: string }).reason).toContain(
      'no edge from "implement" for outcome "failed"',
    );
  });

  it("fails when the visit history exceeds maxNodes", () => {
    const visits = [visit("implement", 1, "success")];
    const t = getNextTransition(reviewLoop, visits, 1);

    expect(t).toMatchObject({ kind: "fail", outcome: "error" });
  });

  it("fails when a recorded node's iteration diverges from the recomputed walk", () => {
    // implement@1 succeeded, but the next row was persisted as validate@2 (wrong
    // iteration) — must fail loudly, not replay a split-brain iteration.
    const visits = [
      visit("implement", 1, "success"),
      visit("validate", 2, "success"),
    ];
    const t = getNextTransition(reviewLoop, visits);

    expect(t).toMatchObject({ kind: "fail", outcome: "error" });
    expect((t as { reason: string }).reason).toContain("diverge");
  });
});

// The executor parity oracle retired with the in-process walk (its extraction-time
// parity run covered every builtin YAML). This keeps a live guarantee: an
// all-success walk of every builtin definition routes node-by-node to finish.
describe("getNextTransition walks every builtin assembly line to finish on success", () => {
  it("routes each builtin definition's success path to the exit", async () => {
    const builtins = await loadBuiltinAssemblyLines();

    expect(builtins.size).toBeGreaterThan(0);

    for (const line of builtins.values()) {
      const visits: NodeVisit[] = [];

      for (let step = 0; step < 50; step++) {
        const t = getNextTransition(line, visits);

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
      expect(getNextTransition(line, visits), line.name).toEqual({
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

    expect(getNextTransition(finalize!, visits)).toMatchObject({
      kind: "launch",
      nodeId: "analyse",
      iteration: 2,
    });

    visits.push(
      { nodeId: "analyse", iteration: 2, outcome: "success" },
      { nodeId: "write", iteration: 2, outcome: "changes_requested" },
    );

    expect(getNextTransition(finalize!, visits).kind).toBe("fail");
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

    expect(getNextTransition(decompose!, visits)).toMatchObject({
      kind: "launch",
      nodeId: "decompose",
      iteration: 2,
    });

    visits.push(
      { nodeId: "decompose", iteration: 2, outcome: "success" },
      { nodeId: "issues", iteration: 2, outcome: "changes_requested" },
    );

    expect(getNextTransition(decompose!, visits).kind).toBe("fail");
  });

  it("ends the line when analyse asks the AUTHOR for changes", async () => {
    // No upstream node to loop to — the input is the plan a human accepted, so the
    // walk routes straight to the exit. Returning the feature to the author is the
    // settlement's job, not the graph's.
    const finalize = (await loadBuiltinAssemblyLines()).get("feature-finalize");

    expect(
      getNextTransition(finalize!, [
        { nodeId: "analyse", iteration: 1, outcome: "changes_requested" },
      ]),
    ).toEqual({ kind: "finish" });
  });
});
