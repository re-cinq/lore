import { describe, it, expect } from "vitest";
import { decideRoundDispatch, type ParkedNode } from "./round-dispatch.js";
import type { RunGraph } from "../project/assembly-runs/run-graph.js";

const node = (over: Partial<ParkedNode> = {}): ParkedNode => ({
  nodeId: "author",
  iteration: 1,
  outcome: null,
  ...over,
});

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

  it("resumes a RENAMED author node by its feature_review type from the run's graph, not a hardcoded id (FR6.32)", () => {
    expect(
      decideRoundDispatch(
        "running",
        [node({ nodeId: "await-author-verdict" })],
        graphWithAuthor("await-author-verdict"),
      ),
    ).toEqual({ kind: "resume", nodeId: "await-author-verdict", iteration: 1 });
  });

  it("resumes iteration 2's parked author row, not iteration 1's already-outcomed one", () => {
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
    expect(decideRoundDispatch(null, [], GRAPHLESS)).toEqual({
      kind: "legacy",
    });
  });

  it("falls back to a fresh line when the line has already finished (the old one-line-per-round shape)", () => {
    expect(
      decideRoundDispatch(
        "finished",
        [node({ nodeId: "analyze", outcome: "success" })],
        GRAPHLESS,
      ),
    ).toEqual({ kind: "legacy" });
  });

  it("falls back when the line is running but nothing is parked, safer than reporting an outcome for a node still working", () => {
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
