import { describe, it, expect } from "vitest";
import { takenEdgeKeys } from "./run-taken-edges";
import {
  codeReviewDefinition,
  implementationDefinition,
} from "./definition-fixtures";
import type { AssemblyLineRunNode } from "./assembly-line-runs";

const node = (nodeId: string, outcome: string | null): AssemblyLineRunNode => ({
  nodeId,
  iteration: 1,
  outcome,
  agentCrName: null,
  commitSha: null,
  durationSeconds: null,
});

describe("takenEdgeKeys", () => {
  it("returns the exact-match edge for a success outcome", () => {
    expect(
      takenEdgeKeys(codeReviewDefinition, [node("review", "success")]),
    ).toEqual(new Set(["review-done-success"]));
  });

  it("returns the changes_requested edge over the other two parallel edges", () => {
    expect(
      takenEdgeKeys(codeReviewDefinition, [
        node("review", "changes_requested"),
      ]),
    ).toEqual(new Set(["review-done-changes_requested"]));
  });

  it("matches a station's kinded outcome to the bare failed edge by suffix", () => {
    expect(
      takenEdgeKeys(implementationDefinition, [
        node("review", "review-failed"),
      ]),
    ).toEqual(new Set(["review-retrospective-failed"]));
  });

  it("falls back to an always edge when no condition matches the outcome", () => {
    expect(
      takenEdgeKeys(implementationDefinition, [node("push", "success")]),
    ).toEqual(new Set(["push-review-always"]));
  });

  it("takes no edge for a node still running", () => {
    expect(takenEdgeKeys(codeReviewDefinition, [node("review", null)])).toEqual(
      new Set(),
    );
  });

  it("returns an empty set for a null definition", () => {
    expect(takenEdgeKeys(null, [node("review", "success")])).toEqual(new Set());
  });

  it("collects a key for every completed node in a multi-node walk", () => {
    expect(
      takenEdgeKeys(implementationDefinition, [
        node("implement", "success"),
        node("validate", "success"),
      ]),
    ).toEqual(new Set(["implement-validate-success", "validate-push-success"]));
  });
});
