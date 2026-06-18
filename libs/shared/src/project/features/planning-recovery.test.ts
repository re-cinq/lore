import { describe, it, expect } from "vitest";
import {
  decidePlanningRecovery,
  PLANNING_RECOVERY_STALE_MS,
  type FeatureIteration,
} from "./features-port.js";
import type { GapResult } from "../../feature-planning/gap-result.js";

const now = 1_000_000_000_000;
const gap: GapResult = { sections: [{ title: "Overview", content: "x" }], draft_spec_markdown: "# x" };

function iter(over: Partial<FeatureIteration>): FeatureIteration {
  return {
    id: "i",
    feature_id: "f",
    iteration: 1,
    task_id: "t",
    status: "ready",
    user_answers: null,
    gap_result: null,
    created_at: new Date(now).toISOString(),
    updated_at: new Date(now).toISOString(),
    ...over,
  };
}

describe("decidePlanningRecovery", () => {
  it("orphans a running round whose runtime is gone (isActive false), regardless of age", () => {
    const latest = iter({ iteration: 2, status: "running", created_at: new Date(now - 60_000).toISOString() });
    expect(decidePlanningRecovery({ iterations: [latest], featureStatus: "planning", isActive: false, nowMs: now }))
      .toEqual({ kind: "orphan", iteration: 2 });
  });

  it("orphans a running round older than the window even when the runtime still reports active", () => {
    const latest = iter({
      iteration: 2,
      status: "running",
      created_at: new Date(now - (PLANNING_RECOVERY_STALE_MS + 60_000)).toISOString(),
    });
    expect(decidePlanningRecovery({ iterations: [latest], featureStatus: "planning", isActive: true, nowMs: now }))
      .toEqual({ kind: "orphan", iteration: 2 });
  });

  it("leaves a recent running round alone while its runtime is active", () => {
    const latest = iter({ iteration: 2, status: "running", created_at: new Date(now - 60_000).toISOString() });
    expect(decidePlanningRecovery({ iterations: [latest], featureStatus: "planning", isActive: true, nowMs: now }))
      .toEqual({ kind: "none" });
  });

  it("transitions a feature stuck 'planning' whose latest round produced a result (missed transition)", () => {
    const latest = iter({ iteration: 1, status: "ready", gap_result: gap });
    expect(decidePlanningRecovery({ iterations: [latest], featureStatus: "planning", isActive: true, nowMs: now }))
      .toEqual({ kind: "transition", iteration: 1 });
  });

  it("does nothing when a ready round already moved the feature out of 'planning'", () => {
    const latest = iter({ iteration: 1, status: "ready", gap_result: gap });
    expect(decidePlanningRecovery({ iterations: [latest], featureStatus: "awaiting-input", isActive: true, nowMs: now }))
      .toEqual({ kind: "none" });
  });

  it("keys on the latest iteration — a newer ready round supersedes an older running one", () => {
    const stale = iter({
      iteration: 1,
      status: "running",
      created_at: new Date(now - (PLANNING_RECOVERY_STALE_MS + 60_000)).toISOString(),
    });
    const latest = iter({ iteration: 2, status: "ready", gap_result: gap });
    expect(decidePlanningRecovery({ iterations: [stale, latest], featureStatus: "planning", isActive: true, nowMs: now }))
      .toEqual({ kind: "transition", iteration: 2 });
  });

  it("does nothing when there are no iterations", () => {
    expect(decidePlanningRecovery({ iterations: [], featureStatus: "planning", isActive: false, nowMs: now }))
      .toEqual({ kind: "none" });
  });
});
