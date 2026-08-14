import { describe, it, expect } from "vitest";
import {
  deriveVisibleGraph,
  outcomeTone,
  type RunData,
} from "./graph-view-model";
import {
  codeReviewDefinition,
  implementationDefinition,
} from "./definition-fixtures";

const runData = (over: Partial<RunData> = {}): RunData => ({
  executed: new Set<string>(),
  verdicts: {},
  statuses: {},
  taken: new Set<string>(),
  result: null,
  ...over,
});

describe("outcomeTone", () => {
  it("maps success to ok, changes_requested to warn, failed to err", () => {
    expect([
      outcomeTone("success"),
      outcomeTone("changes_requested"),
      outcomeTone("failed"),
      outcomeTone("review-failed"),
      outcomeTone("always"),
    ]).toEqual(["ok", "warn", "err", "err", "neutral"]);
  });
});

describe("deriveVisibleGraph run mode", () => {
  it("shows one review node, one terminal node and one connector for a failed run", () => {
    const graph = deriveVisibleGraph(
      codeReviewDefinition,
      runData({
        executed: new Set(["review", "done"]),
        verdicts: { review: "failed" },
        taken: new Set(["review-done-failed"]),
        result: "failed",
      }),
      "run",
    );

    expect(graph.nodes.map((n) => n.id)).toEqual(["review", "done"]);
    expect(graph.edges).toEqual([
      { from: "review", to: "done", tone: "neutral", taken: true },
    ]);
  });

  it("does not draw the failed or changes_requested paths for a successful run", () => {
    const graph = deriveVisibleGraph(
      codeReviewDefinition,
      runData({
        executed: new Set(["review", "done"]),
        verdicts: { review: "success" },
        taken: new Set(["review-done-success"]),
        result: "completed",
      }),
      "run",
    );

    expect(graph.edges).toHaveLength(1);
    expect(graph.edges).toEqual([
      { from: "review", to: "done", tone: "neutral", taken: true },
    ]);
  });

  it("carries the changes_requested verdict on the review node", () => {
    const graph = deriveVisibleGraph(
      codeReviewDefinition,
      runData({
        executed: new Set(["review", "done"]),
        verdicts: { review: "changes_requested" },
        taken: new Set(["review-done-changes_requested"]),
        result: "completed",
      }),
      "run",
    );

    expect(graph.nodes.find((n) => n.id === "review")?.verdict).toBe(
      "changes_requested",
    );
  });

  it("puts the run result on the terminal node only", () => {
    const graph = deriveVisibleGraph(
      codeReviewDefinition,
      runData({
        executed: new Set(["review", "done"]),
        verdicts: { review: "failed" },
        taken: new Set(["review-done-failed"]),
        result: "failed",
      }),
      "run",
    );

    expect(graph.nodes.find((n) => n.id === "done")?.result).toBe("failed");
    expect(graph.nodes.find((n) => n.id === "review")?.result).toBeNull();
  });
});

describe("deriveVisibleGraph definition mode", () => {
  it("renders one connector and lists the outcomes in the source node when all lead to one step", () => {
    const graph = deriveVisibleGraph(codeReviewDefinition, null, "definition");

    const reviewToDone = graph.edges.filter(
      (e) => e.from === "review" && e.to === "done",
    );

    expect(reviewToDone).toEqual([
      { from: "review", to: "done", tone: "neutral" },
    ]);
    expect(graph.nodes.find((n) => n.id === "review")?.outcomes).toEqual([
      "success",
      "changes_requested",
      "failed",
    ]);
  });

  it("renders separate branches when outcomes lead to different steps", () => {
    const graph = deriveVisibleGraph(
      implementationDefinition,
      null,
      "definition",
    );
    const fromReview = graph.edges.filter((e) => e.from === "review");

    // review branches to retrospective (success/failed) and address (changes_requested)
    expect(new Set(fromReview.map((e) => e.to))).toEqual(
      new Set(["retrospective", "address"]),
    );
    // the changes_requested branch is color-coded (warn)
    expect(fromReview.find((e) => e.to === "address")).toMatchObject({
      tone: "warn",
    });
    // outcomes are still listed inside the source node, never on the connector
    expect(graph.nodes.find((n) => n.id === "review")?.outcomes).toEqual([
      "success",
      "changes_requested",
      "failed",
    ]);
  });

  it("falls back to definition mode when run mode has no run data", () => {
    const graph = deriveVisibleGraph(codeReviewDefinition, null, "run");

    expect(graph.mode).toBe("definition");
  });
});

describe("deriveVisibleGraph run mode over a part-run line", () => {
  const midRun = runData({
    executed: new Set(["implement", "validate"]),
    verdicts: { implement: "success" },
    statuses: { implement: "succeeded", validate: "running" },
    taken: new Set(["implement-validate-success"]),
  });

  it("keeps every step of the line, with the unreached ones idle", () => {
    const graph = deriveVisibleGraph(implementationDefinition, midRun, "run");

    expect(graph.nodes.map((n) => n.id)).toEqual([
      "implement",
      "validate",
      "push",
      "review",
      "address",
      "retrospective",
      "done",
    ]);
    expect(graph.nodes.find((n) => n.id === "push")).toMatchObject({
      status: "idle",
      verdict: null,
      outcomes: [],
    });
  });

  it("marks the traversed hop taken and the untraversed ones not", () => {
    const graph = deriveVisibleGraph(implementationDefinition, midRun, "run");
    const hop = (from: string, to: string) =>
      graph.edges.find((e) => e.from === from && e.to === to);

    expect(hop("implement", "validate")).toMatchObject({ taken: true });
    expect(hop("push", "review")).toMatchObject({ taken: false });
  });

  it("leaves the result off a terminal the walk never reached", () => {
    const graph = deriveVisibleGraph(
      implementationDefinition,
      runData({ executed: new Set(["implement"]), result: "failed" }),
      "run",
    );

    expect(graph.nodes.find((n) => n.id === "done")?.result).toBeNull();
  });
});
