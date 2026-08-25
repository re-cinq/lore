import { describe, it, expect } from "vitest";
import { MERGE_STEPS, runMergeStep } from "./merge-step.js";
import type { MergeStepDeps } from "./merge-step.js";

const TASK = {
  id: "t-1",
  target_repo: "o/r",
  pr_number: 7,
  issue_number: 3,
  task_type: "implementation",
  description: "do the thing",
};

function deps(over: Partial<MergeStepDeps> = {}): MergeStepDeps {
  return {
    task: async () => TASK,
    setStatus: async () => {},
    recordEvent: async () => {},
    flipSpecStatus: async () => {},
    commentAndCloseIssue: async () => {},
    recordOutcome: async () => {},
    curate: async () => {},
    applyOutcomeFeedback: async () => {},
    promoteTrust: async () => {},
    syncSpecTasks: async () => {},
    resumePlanning: async () => {},
    ...over,
  };
}

describe("the merge line's steps", () => {
  it("names one step per node of the blueprint", () => {
    expect([...MERGE_STEPS]).toEqual([
      "settle",
      "spec-status",
      "close-issue",
      "outcome-stats",
      "curate",
      "memory-feedback",
      "trust",
      "spec-tasks",
      "resume-planning",
    ]);
  });

  it("marks the task merged and records the transition on settle", async () => {
    const seen: string[] = [];

    await runMergeStep(
      "settle",
      "t-1",
      deps({
        setStatus: async (_id, status) => {
          seen.push(`status:${status}`);
        },
        recordEvent: async () => {
          seen.push("event");
        },
      }),
    );

    expect(seen).toEqual(["status:merged", "event"]);
  });

  it("resumes the planning line parked on the spec PR", async () => {
    const resumed: number[] = [];

    await runMergeStep(
      "resume-planning",
      "t-1",
      deps({
        resumePlanning: async (_repo, pr) => {
          resumed.push(pr);
        },
      }),
    );

    expect(resumed).toEqual([7]);
  });

  it("lets a step's failure surface, since the line records it and walks on", async () => {
    await expect(
      runMergeStep(
        "trust",
        "t-1",
        deps({
          promoteTrust: async () => {
            throw new Error("trust ladder is down");
          },
        }),
      ),
    ).rejects.toThrow("trust ladder is down");
  });

  it("does nothing on spec-tasks for a task type that has none", async () => {
    const synced: string[] = [];

    await runMergeStep(
      "spec-tasks",
      "t-1",
      deps({
        task: async () => ({ ...TASK, task_type: "implementation" }),
        syncSpecTasks: async (t) => {
          synced.push(t.id);
        },
      }),
    );

    expect(synced).toEqual([]);
  });

  it("syncs spec-tasks for a merged feature-request, which is what produces them", async () => {
    const synced: string[] = [];

    await runMergeStep(
      "spec-tasks",
      "t-1",
      deps({
        task: async () => ({ ...TASK, task_type: "feature-request" }),
        syncSpecTasks: async (t) => {
          synced.push(t.id);
        },
      }),
    );

    expect(synced).toEqual(["t-1"]);
  });

  it("refuses a step the blueprint could not have named", async () => {
    await expect(runMergeStep("nosuchstep", "t-1", deps())).rejects.toThrow(
      /nosuchstep/,
    );
  });

  it("refuses to act on a task that no longer exists", async () => {
    await expect(
      runMergeStep("settle", "gone", deps({ task: async () => null })),
    ).rejects.toThrow(/gone/);
  });
});
