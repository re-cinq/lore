import { describe, expect, it } from "vitest";
import type { Tools } from "@re-cinq/floor-station";
import type { MergeStepDeps } from "../../work/merge-step/merge-step.js";
import {
  FLOOR_MERGE_STEPS,
  mergeStationName,
  mergeStepHandle,
} from "./station.js";

const TOOLS: Tools = {
  read: () => Promise.resolve(Buffer.from("")),
  produce: () => Promise.resolve(),
  modelCall: () => Promise.resolve(),
  signal: new AbortController().signal,
};

const TASK = {
  id: "t-1",
  target_repo: "o/r",
  pr_number: 7,
  issue_number: 3,
  task_type: "implementation",
  description: "do the thing",
};

function scene(over: Partial<MergeStepDeps> = {}) {
  const calls: string[] = [];
  const record = (name: string) => async () => {
    calls.push(name);
  };
  const deps: MergeStepDeps = {
    task: async (taskId) => (taskId === TASK.id ? TASK : null),
    setStatus: async (_taskId, status) => {
      calls.push(`setStatus ${status}`);
    },
    recordEvent: record("recordEvent"),
    flipSpecStatus: record("flipSpecStatus"),
    commentAndCloseIssue: record("commentAndCloseIssue"),
    recordOutcome: record("recordOutcome"),
    curate: record("curate"),
    applyOutcomeFeedback: record("applyOutcomeFeedback"),
    promoteTrust: record("promoteTrust"),
    syncSpecTasks: record("syncSpecTasks"),
    resumePlanning: record("resumePlanning"),
    ...over,
  };

  return { calls, deps: () => deps };
}

const brief = (taskId = "t-1") => ({
  visitId: "visit-1",
  iteration: 1,
  needs: { task_id: taskId },
});

describe("the merge line's floor stations", () => {
  it("serves settle, spec-status, close-issue, outcome-stats, curate, memory-feedback, trust and spec-tasks, and not resume-planning", () => {
    expect(FLOOR_MERGE_STEPS.map(mergeStationName)).toEqual([
      "merge-settle",
      "merge-spec-status",
      "merge-close-issue",
      "merge-outcome-stats",
      "merge-curate",
      "merge-memory-feedback",
      "merge-trust",
      "merge-spec-tasks",
    ]);
  });

  it("marks task t-1 merged and reports success for the settle station", async () => {
    const { calls, deps } = scene();
    const report = await mergeStepHandle("settle", deps)(brief(), TOOLS);

    expect(report).toEqual({ outcome: "success" });
    expect(calls).toEqual(["setStatus merged", "recordEvent"]);
  });

  it("closes the issue of task t-1 for the close-issue station", async () => {
    const { calls, deps } = scene();

    await mergeStepHandle("close-issue", deps)(brief(), TOOLS);

    expect(calls).toEqual(["commentAndCloseIssue"]);
  });

  it("reports failed with the step and the reason when the trust step throws", async () => {
    const { deps } = scene({
      promoteTrust: () => Promise.reject(new Error("settings unreadable")),
    });
    const report = await mergeStepHandle("trust", deps)(brief(), TOOLS);

    expect(report).toEqual({
      outcome: "failed",
      error: 'merge step "trust": settings unreadable',
    });
  });

  it("reports failed when task t-9 no longer exists", async () => {
    const { deps } = scene();
    const report = await mergeStepHandle("settle", deps)(brief("t-9"), TOOLS);

    expect(report).toEqual({
      outcome: "failed",
      error: 'merge step "settle": task t-9 no longer exists',
    });
  });
});
