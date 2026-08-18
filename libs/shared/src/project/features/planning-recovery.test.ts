import { describe, it, expect } from "vitest";
import {
  decidePlanningRecovery,
  PLANNING_RECOVERY_STALE_MS,
  PLANNING_STARTUP_GRACE_MS,
  type FeatureIteration,
} from "./features-port.js";
import type { GapResult } from "../../feature-planning/gap-result.js";

const now = 1_000_000_000_000;
const gap: GapResult = {
  sections: [{ title: "Overview", content: "x" }],
  draft_spec_markdown: "# x",
};

function iter(over: Partial<FeatureIteration>): FeatureIteration {
  return {
    id: "i",
    feature_id: "f",
    iteration: 1,
    task_id: "t",
    status: "ready",
    user_answers: null,
    gap_result: null,
    parent_iteration: null,
    created_at: new Date(now).toISOString(),
    updated_at: new Date(now).toISOString(),
    ...over,
  };
}

describe("decidePlanningRecovery", () => {
  it("orphans a running round whose runtime is gone once it is past the startup grace", () => {
    const latest = iter({
      iteration: 2,
      status: "running",
      created_at: new Date(now - 5 * 60_000).toISOString(),
    });

    expect(
      decidePlanningRecovery({
        iterations: [latest],
        featureStatus: "planning",
        isActive: false,
        nowMs: now,
      }),
    ).toEqual({ kind: "orphan", iteration: 2 });
  });

  it("orphans a running round older than the window even when the runtime still reports active", () => {
    const latest = iter({
      iteration: 2,
      status: "running",
      created_at: new Date(
        now - (PLANNING_RECOVERY_STALE_MS + 60_000),
      ).toISOString(),
    });

    expect(
      decidePlanningRecovery({
        iterations: [latest],
        featureStatus: "planning",
        isActive: true,
        nowMs: now,
      }),
    ).toEqual({ kind: "orphan", iteration: 2 });
  });

  it("leaves a recent running round alone while its runtime is active", () => {
    const latest = iter({
      iteration: 2,
      status: "running",
      created_at: new Date(now - 60_000).toISOString(),
    });

    expect(
      decidePlanningRecovery({
        iterations: [latest],
        featureStatus: "planning",
        isActive: true,
        nowMs: now,
      }),
    ).toEqual({ kind: "none" });
  });

  it("transitions a feature stuck 'planning' whose latest round produced a result (missed transition)", () => {
    const latest = iter({ iteration: 1, status: "ready", gap_result: gap });

    expect(
      decidePlanningRecovery({
        iterations: [latest],
        featureStatus: "planning",
        isActive: true,
        nowMs: now,
      }),
    ).toEqual({ kind: "transition", iteration: 1 });
  });

  it("does nothing when a ready round already moved the feature out of 'planning'", () => {
    const latest = iter({ iteration: 1, status: "ready", gap_result: gap });

    expect(
      decidePlanningRecovery({
        iterations: [latest],
        featureStatus: "awaiting-input",
        isActive: true,
        nowMs: now,
      }),
    ).toEqual({ kind: "none" });
  });

  it("keys on the latest iteration — a newer ready round supersedes an older running one", () => {
    const stale = iter({
      iteration: 1,
      status: "running",
      created_at: new Date(
        now - (PLANNING_RECOVERY_STALE_MS + 60_000),
      ).toISOString(),
    });
    const latest = iter({ iteration: 2, status: "ready", gap_result: gap });

    expect(
      decidePlanningRecovery({
        iterations: [stale, latest],
        featureStatus: "planning",
        isActive: true,
        nowMs: now,
      }),
    ).toEqual({ kind: "transition", iteration: 2 });
  });

  it("does nothing when there are no iterations", () => {
    expect(
      decidePlanningRecovery({
        iterations: [],
        featureStatus: "planning",
        isActive: false,
        nowMs: now,
      }),
    ).toEqual({ kind: "none" });
  });
});

describe("decidePlanningRecovery — startup grace", () => {
  const running = (ageMs: number): FeatureIteration =>
    iter({
      iteration: 2,
      status: "running",
      created_at: new Date(now - ageMs).toISOString(),
    });

  it("leaves a just-started round alone when no runtime is visible yet", () => {
    // The Agent CR does not exist for the first seconds of a round: the task row is
    // written, then the line, then the CR. A probe in that window means "not born
    // yet", not "died" — round 10 was force-failed 32s in and only survived because
    // the delivered result overrode the reaper.
    expect(
      decidePlanningRecovery({
        iterations: [running(32_000)],
        featureStatus: "planning",
        isActive: false,
        nowMs: now,
      }),
    ).toEqual({ kind: "none" });
  });

  it("orphans a round past the grace window whose runtime is gone", () => {
    expect(
      decidePlanningRecovery({
        iterations: [running(PLANNING_STARTUP_GRACE_MS + 1_000)],
        featureStatus: "planning",
        isActive: false,
        nowMs: now,
      }),
    ).toEqual({ kind: "orphan", iteration: 2 });
  });

  it("still force-fails a wedged round past the stale window even while active", () => {
    // Staleness is independent of the probe: a container that never exits must not
    // be protected by the grace window.
    expect(
      decidePlanningRecovery({
        iterations: [running(PLANNING_RECOVERY_STALE_MS + 1_000)],
        featureStatus: "planning",
        isActive: true,
        nowMs: now,
      }),
    ).toEqual({ kind: "orphan", iteration: 2 });
  });

  it("leaves a live round inside the grace window alone", () => {
    expect(
      decidePlanningRecovery({
        iterations: [running(5_000)],
        featureStatus: "planning",
        isActive: true,
        nowMs: now,
      }),
    ).toEqual({ kind: "none" });
  });
});

describe("decidePlanningRecovery with an open assembly run (#1297)", () => {
  const running = (ageMs: number): FeatureIteration =>
    iter({
      iteration: 2,
      status: "running",
      created_at: new Date(now - ageMs).toISOString(),
    });

  it("never orphans a running round whose assembly run is open, whatever the probe said", () => {
    // The run is the single liveness authority: its own reaper times it out and
    // relaunches its CRs. A transiently empty CR listing must not execute a live
    // round — on 2026-08-18 it did, a minute before the agent SUCCEEDED.
    expect(
      decidePlanningRecovery({
        iterations: [running(PLANNING_RECOVERY_STALE_MS + 1_000)],
        featureStatus: "planning",
        isActive: false,
        nowMs: now,
        runOpen: true,
      }),
    ).toEqual({ kind: "none" });
  });

  it("still orphans past the window once the run is no longer open", () => {
    expect(
      decidePlanningRecovery({
        iterations: [running(PLANNING_RECOVERY_STALE_MS + 1_000)],
        featureStatus: "planning",
        isActive: false,
        nowMs: now,
        runOpen: false,
      }),
    ).toEqual({ kind: "orphan", iteration: 2 });
  });
});
