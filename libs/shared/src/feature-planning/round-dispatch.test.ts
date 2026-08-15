// Where a planning round goes: back to the line that is waiting for it, or —
// for a feature created before the merged line existed — down the old path that
// mints a line per round.
//
// The migration seam. Features already in flight when this shipped have no parked
// node to report to, and a wizard that assumed one would strand them mid-plan.

import { describe, it, expect } from "vitest";
import { decideRoundDispatch, type ParkedNode } from "./round-dispatch.js";
import type { RunGraph } from "../project/assembly-runs/run-graph.js";

const node = (over: Partial<ParkedNode> = {}): ParkedNode => ({
  nodeId: "author",
  iteration: 1,
  outcome: null,
  ...over,
});

/** A run stamped before clones existed — the id-based fallback path. */
const GRAPHLESS = null;

const graphWithAuthor = (authorNodeId: string): RunGraph => ({
  name: "feature-planning",
  entry: "analyze",
  exit: authorNodeId,
  nodes: [
    {
      id: "analyze",
      type: "agent",
      station: "feature-planning",
      station_inherited: true,
    },
    {
      id: authorNodeId,
      type: "feature_review",
      station: null,
      station_inherited: false,
    },
  ],
  edges: [],
});

describe("decideRoundDispatch", () => {
  it("resumes the author node the line is parked on", () => {
    expect(decideRoundDispatch("running", [node()], GRAPHLESS)).toEqual({
      kind: "resume",
      nodeId: "author",
      iteration: 1,
    });
  });

  it("resumes a RENAMED author node by its feature_review type from the run's graph", () => {
    // The join that must survive a blueprint rename — a hardcoded id is how the
    // pr_merged signal silently died (FR6.32).
    expect(
      decideRoundDispatch(
        "running",
        [node({ nodeId: "await-author-verdict" })],
        graphWithAuthor("await-author-verdict"),
      ),
    ).toEqual({ kind: "resume", nodeId: "await-author-verdict", iteration: 1 });
  });

  it("resumes the parked node of a later round, not the first", () => {
    // Round 2's author row carries iteration 2; reporting against iteration 1
    // would complete a node that already has an outcome and leave the walk stuck.
    expect(
      decideRoundDispatch(
        "running",
        [
          node({ iteration: 1, outcome: "changes_requested" }),
          node({ iteration: 2 }),
        ],
        graphWithAuthor("author"),
      ),
    ).toEqual({ kind: "resume", nodeId: "author", iteration: 2 });
  });

  it("falls back to a fresh line when the feature has none", () => {
    // A feature whose planning predates the merged line.
    expect(decideRoundDispatch(null, [], GRAPHLESS)).toEqual({
      kind: "legacy",
    });
  });

  it("falls back to a fresh line when the line has already finished", () => {
    // The old shape: one line per round, each finished the moment its round landed.
    expect(
      decideRoundDispatch(
        "finished",
        [node({ nodeId: "analyze", outcome: "success" })],
        GRAPHLESS,
      ),
    ).toEqual({ kind: "legacy" });
  });

  it("falls back when the line is running but nothing is parked", () => {
    // A round is still in flight. The endpoint's own in-flight guard rejects this
    // first; if it ever does not, minting a line is safer than reporting an outcome
    // for a node that is still working.
    expect(
      decideRoundDispatch(
        "running",
        [node({ nodeId: "analyze" })],
        graphWithAuthor("author"),
      ),
    ).toEqual({ kind: "legacy" });
  });

  it("ignores an author node that already has an outcome", () => {
    expect(
      decideRoundDispatch(
        "running",
        [node({ outcome: "changes_requested" })],
        graphWithAuthor("author"),
      ),
    ).toEqual({ kind: "legacy" });
  });
});
