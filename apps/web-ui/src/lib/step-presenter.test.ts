import { describe, it, expect } from "vitest";
import { stepViews } from "./step-presenter";
import {
  featurePlanningDefinition,
  implementationDefinition,
} from "./definition-fixtures";
import type { AssemblyRunNode } from "./assembly-runs";

const node = (over: Partial<AssemblyRunNode> = {}): AssemblyRunNode => ({
  nodeId: "implement",
  iteration: 1,
  outcome: "success",
  agentCrName: null,
  commitSha: null,
  durationSeconds: 10,
  ...over,
});

describe("stepViews", () => {
  it("labels a success outcome Succeeded with an ok tone", () => {
    expect(stepViews(implementationDefinition, [node()])[0]).toMatchObject({
      tone: "ok",
      label: "Succeeded",
    });
  });

  it("labels a changes_requested outcome as changes requested with a warn tone", () => {
    expect(
      stepViews(implementationDefinition, [
        node({ nodeId: "review", outcome: "changes_requested" }),
      ])[0],
    ).toMatchObject({ tone: "warn", label: "Changes requested" });
  });

  it("labels a kinded failed outcome Failed with an err tone", () => {
    expect(
      stepViews(implementationDefinition, [
        node({ outcome: "implement-failed" }),
      ])[0],
    ).toMatchObject({ tone: "err", label: "Failed" });
  });

  it("labels an open visit of the author station Waiting for you, not Running", () => {
    expect(
      stepViews(featurePlanningDefinition, [
        node({ nodeId: "author", iteration: 2, outcome: null }),
      ])[0],
    ).toMatchObject({ tone: "waiting", label: "Waiting for you" });
  });

  it("labels a reported visit of the author station by its outcome", () => {
    expect(
      stepViews(featurePlanningDefinition, [
        node({ nodeId: "author", outcome: "changes_requested" }),
      ])[0],
    ).toMatchObject({ tone: "warn", label: "Changes requested" });
  });

  it("labels a null outcome Running", () => {
    expect(
      stepViews(implementationDefinition, [node({ outcome: null })])[0],
    ).toMatchObject({ tone: "running", label: "Running" });
  });

  it("annotates a forward branch with the arrow and target", () => {
    expect(
      stepViews(implementationDefinition, [node({ outcome: "success" })])[0]
        .transition,
    ).toBe("success → validate");
  });

  it("annotates a retry with a back arrow to the loop target", () => {
    expect(
      stepViews(implementationDefinition, [
        node({ nodeId: "validate", outcome: "failed" }),
      ])[0].transition,
    ).toBe("failed ↩ implement");
  });

  it("carries no transition for a running step", () => {
    expect(
      stepViews(implementationDefinition, [node({ outcome: null })])[0]
        .transition,
    ).toBeNull();
  });

  it("surfaces the run reason only against a failing step", () => {
    const [ok, bad] = stepViews(
      implementationDefinition,
      [node({ outcome: "success" }), node({ outcome: "implement-failed" })],
      "pod exited non-zero",
    );

    expect(ok.reason).toBeNull();
    expect(bad.reason).toBe("pod exited non-zero");
  });

  it("shows the failed issues step's own 'body is too long' over the run reason", () => {
    const [bad] = stepViews(
      implementationDefinition,
      [node({ outcome: "failed", failureDetail: "body is too long" })],
      "pod exited non-zero",
    );

    expect(bad?.reason).toBe("body is too long");
  });

  it("preserves execution order and one step per row", () => {
    const steps = stepViews(implementationDefinition, [
      node({ nodeId: "implement" }),
      node({ nodeId: "validate" }),
      node({ nodeId: "push" }),
    ]);

    expect(steps.map((s) => s.nodeId)).toEqual([
      "implement",
      "validate",
      "push",
    ]);
  });
});
