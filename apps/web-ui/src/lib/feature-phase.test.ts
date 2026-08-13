import { describe, it, expect } from "vitest";
import { featurePhaseOf } from "./feature-phase";
import type { AssemblyLineRunNode } from "./assembly-line-runs";

const node = (
  nodeId: string,
  outcome: string | null,
  startedAt?: string,
): AssemblyLineRunNode => ({
  nodeId,
  iteration: 1,
  outcome,
  agentCrName: `x-${nodeId}`,
  commitSha: null,
  durationSeconds: null,
  startedAt,
});

const run = (status: string, nodes: AssemblyLineRunNode[]) => ({
  status,
  nodes,
});

const feature = (status: string) => ({ status }) as never;

describe("featurePhaseOf — read from the line", () => {
  it("reports planning while the analyze node works", () => {
    expect(
      featurePhaseOf({
        run: run("running", [node("analyze", null, "2026-08-13T10:00:00Z")]),
        feature: feature("planning"),
      }),
    ).toEqual({
      kind: "planning",
      nodeId: "analyze",
      nodeIteration: 1,
      since: "2026-08-13T10:00:00Z",
    });
  });

  it("reports awaiting-author while the author node is parked", () => {
    expect(
      featurePhaseOf({
        run: run("running", [
          node("analyze", "success"),
          node("author", null, "2026-08-13T10:05:00Z"),
        ]),
        feature: feature("awaiting-input"),
      }),
    ).toMatchObject({ kind: "awaiting-author", nodeId: "author" });
  });

  it("reports writing-spec for each of the three spec nodes", () => {
    for (const id of ["analyse-specs", "write", "push"]) {
      expect(
        featurePhaseOf({
          run: run("running", [node("author", "success"), node(id, null)]),
          feature: feature("spec-ready"),
        }),
      ).toMatchObject({ kind: "writing-spec", nodeId: id });
    }
  });

  it("times the phase from the working NODE, not from the round", () => {
    // The bug spec-phase.ts's doc comment records: timing from the round read as
    // 80+ minutes of a 15 minute budget while nothing was running at all.
    expect(
      featurePhaseOf({
        run: run("running", [
          node("analyze", "success", "2026-08-13T09:00:00Z"),
          node("write", null, "2026-08-13T11:30:00Z"),
        ]),
        feature: feature("spec-ready"),
      }),
    ).toMatchObject({ since: "2026-08-13T11:30:00Z" });
  });

  it("takes the LAST open node when several are open", () => {
    expect(
      featurePhaseOf({
        run: run("running", [node("analyze", null), node("write", null)]),
        feature: feature("spec-ready"),
      }),
    ).toMatchObject({ kind: "writing-spec", nodeId: "write" });
  });

  it("reports failed when a node on the line failed", () => {
    expect(
      featurePhaseOf({
        run: run("running", [node("analyze", "failed")]),
        feature: feature("planning"),
      }),
    ).toMatchObject({ kind: "failed" });
  });

  it("reports failed for a line that ended failed", () => {
    expect(
      featurePhaseOf({
        run: {
          ...run("finished", [node("analyze", "success")]),
          outcome: "failed",
        },
        feature: feature("planning"),
      }),
    ).toMatchObject({ kind: "failed" });
  });

  it("falls back rather than guessing when a running line has no open node", () => {
    // Between nodes: the walk is about to launch the next one. The line cannot say
    // which phase that is, so the rows we do have decide.
    expect(
      featurePhaseOf({
        run: run("running", [node("analyze", "success")]),
        feature: feature("awaiting-input"),
        latestIteration: { status: "ready", gap_result: { sections: [] } },
      }),
    ).toMatchObject({ kind: "awaiting-author" });
  });
});

it("reports awaiting-merge while the spec PR is open", () => {
  // The `merged` wait node: the branch is pushed, the PR is open, and the line
  // is parked until a human merges it.
  expect(
    featurePhaseOf({
      run: run("running", [node("push", "success"), node("merged", null)]),
      feature: feature("pr-open"),
    }),
  ).toMatchObject({ kind: "awaiting-merge", nodeId: "merged" });
});

it("carries the NODE's attempt count, not the round's", () => {
  // The decompose node can be sent back for a correction, which mints a second row
  // for the same node. That retry count is the line's, and has nothing to do with
  // how many planning ROUNDS the author ran before the PR existed.
  expect(
    featurePhaseOf({
      run: run("running", [
        { ...node("decompose", "changes_requested"), iteration: 1 },
        { ...node("decompose", null), iteration: 2 },
      ]),
      feature: feature("pr-open"),
    }),
  ).toMatchObject({ kind: "decomposing", nodeIteration: 2 });
});

it("reports decomposing for both nodes of the decomposition tail", () => {
  for (const id of ["decompose", "issues"]) {
    expect(
      featurePhaseOf({
        run: run("running", [node("merged", "success"), node(id, null)]),
        feature: feature("pr-open"),
      }),
    ).toMatchObject({ kind: "decomposing", nodeId: id });
  }
});

describe("featurePhaseOf — the legacy fallback", () => {
  // A feature whose planning predates the merged line minted a task per round and
  // resolves no line at all. It must keep working.
  it("reports planning while the round's task is still running", () => {
    expect(
      featurePhaseOf({
        run: null,
        feature: feature("planning"),
        latestIteration: { status: "running", gap_result: null },
        task: { status: "running" },
      }),
    ).toMatchObject({ kind: "planning" });
  });

  it("reports awaiting-author once a round produced an analysis", () => {
    expect(
      featurePhaseOf({
        run: null,
        feature: feature("awaiting-input"),
        latestIteration: { status: "ready", gap_result: { sections: [] } },
        task: { status: "completed" },
      }),
    ).toMatchObject({ kind: "awaiting-author" });
  });

  it("reports failed when the round's task failed", () => {
    expect(
      featurePhaseOf({
        run: null,
        feature: feature("planning"),
        latestIteration: { status: "running", gap_result: null },
        task: { status: "failed" },
      }),
    ).toMatchObject({ kind: "failed" });
  });

  it("reports failed when the round settled without producing anything usable", () => {
    // The round's task ended but the iteration is still 'running' with no result —
    // a hard crash. Without this the wizard span forever.
    expect(
      featurePhaseOf({
        run: null,
        feature: feature("planning"),
        latestIteration: { status: "running", gap_result: null },
        task: { status: "completed" },
      }),
    ).toMatchObject({ kind: "failed" });
  });

  it("reports done once the feature has left the planning phase", () => {
    for (const status of ["pr-open", "implemented"]) {
      expect(
        featurePhaseOf({ run: null, feature: feature(status) }),
      ).toMatchObject({ kind: "done" });
    }
  });

  it("reports planning for a fresh draft with no round yet", () => {
    expect(
      featurePhaseOf({ run: null, feature: feature("draft") }),
    ).toMatchObject({ kind: "planning" });
  });
});
