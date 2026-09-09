import { describe, it, expect } from "vitest";
import {
  decideFeatureImplemented,
  decideSpecStatusFlip,
} from "./merge-check.js";

type GateTask = Parameters<typeof decideSpecStatusFlip>[0];

const task = (over: Partial<GateTask> = {}): GateTask => ({
  task_type: "spec-task",
  task_group_id: "g1",
  context_bundle: { feature_id: "f1" },
  ...over,
});

describe("decideSpecStatusFlip", () => {
  it("returns the feature id when the last spec-task in a group merges", () => {
    expect(decideSpecStatusFlip(task(), 0)).toEqual({ featureId: "f1" });
  });

  it("returns null while siblings in the group are still unmerged", () => {
    expect(decideSpecStatusFlip(task(), 2)).toBeNull();
  });

  it("returns null for a non-spec-task type", () => {
    expect(decideSpecStatusFlip(task({ task_type: "general" }), 0)).toBeNull();
  });

  it("returns null for a task with no group", () => {
    expect(decideSpecStatusFlip(task({ task_group_id: null }), 0)).toBeNull();
  });

  it("returns null when the bundle carries no feature id", () => {
    expect(decideSpecStatusFlip(task({ context_bundle: {} }), 0)).toBeNull();
    expect(decideSpecStatusFlip(task({ context_bundle: null }), 0)).toBeNull();
  });
});

describe("decideFeatureImplemented", () => {
  it("returns true when the flip PR set the spec to shipped", () => {
    expect(
      decideFeatureImplemented({
        prUrl: "https://example.test/pr/1",
        skipped: false,
        status: "shipped",
      }),
    ).toBe(true);
  });

  it("returns true when the spec already claimed shipped", () => {
    expect(
      decideFeatureImplemented({
        prUrl: null,
        skipped: true,
        reason: "already-current",
        status: "shipped",
      }),
    ).toBe(true);
  });

  it("returns false when coverage only supported In Progress", () => {
    expect(
      decideFeatureImplemented({
        prUrl: "https://example.test/pr/1",
        skipped: false,
        status: "in-progress",
      }),
    ).toBe(false);
  });

  it("returns false when the spec already claimed a status short of shipped", () => {
    expect(
      decideFeatureImplemented({
        prUrl: null,
        skipped: true,
        reason: "already-current",
        status: "draft",
      }),
    ).toBe(false);
  });

  it("returns false for a shipped spec with no testable statement to confirm it", () => {
    expect(
      decideFeatureImplemented({
        prUrl: null,
        skipped: true,
        reason: "no-coverage-tier",
        status: "shipped",
      }),
    ).toBe(false);
  });

  it("returns false when the spec is missing, terminal, or has no status row", () => {
    expect(
      decideFeatureImplemented({
        prUrl: null,
        skipped: true,
        reason: "missing",
      }),
    ).toBe(false);
    expect(
      decideFeatureImplemented({
        prUrl: null,
        skipped: true,
        reason: "terminal",
        status: "retired",
      }),
    ).toBe(false);
    expect(
      decideFeatureImplemented({
        prUrl: null,
        skipped: true,
        reason: "no-status-row",
      }),
    ).toBe(false);
  });
});
