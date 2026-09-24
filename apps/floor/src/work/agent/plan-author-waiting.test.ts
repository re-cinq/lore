import { describe, it, expect } from "vitest";
import type { AssemblyRunRecord } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-port.js";
import type { RunGraphNode } from "@re-cinq/lore-shared/project/assembly-runs/run-graph.js";
import { decideParkReaction, reopenPlanOnPark } from "./plan-author-waiting.js";

const run = (args: Record<string, unknown>) =>
  ({ id: "run-1", repo: "re-cinq/lore", args }) as AssemblyRunRecord;

const node = (id: string, type: string) => ({ id, type }) as RunGraphNode;

const recordingOpener = () => {
  const opened: Array<{ repo: string; planId: string }> = [];
  const reopened: Array<{ repo: string; planId: string; actor: string }> = [];
  const merged: Array<{ id: string; patch: Record<string, unknown> }> = [];

  return {
    opened,
    reopened,
    merged,
    react: reopenPlanOnPark({
      plans: {
        openForAuthor: async (repo, planId) =>
          void opened.push({ repo, planId }),
        reopenForReview: async (repo, planId, actor) =>
          void reopened.push({ repo, planId, actor }),
      },
      assemblyRuns: {
        mergeArgs: async (id, patch) => void merged.push({ id, patch }),
      },
    }),
  };
};

describe("decideParkReaction", () => {
  it("opens for the author on a feature_review park, reopens for review on a pr_review park flagged spec_review_reopen, and does nothing otherwise", () => {
    expect({
      author: decideParkReaction(node("author", "feature_review"), {
        plan_id: "p1",
      }),
      prWaitFlagged: decideParkReaction(node("merged", "pr_review"), {
        plan_id: "p1",
        spec_review_reopen: true,
      }),
      prWaitUnflagged: decideParkReaction(node("merged", "pr_review"), {
        plan_id: "p1",
      }),
      prWaitCleared: decideParkReaction(node("merged", "pr_review"), {
        plan_id: "p1",
        spec_review_reopen: null,
      }),
      authorNoPlan: decideParkReaction(node("author", "feature_review"), {}),
      ciCheck: decideParkReaction(node("ci", "ci_check"), {
        plan_id: "p1",
        spec_review_reopen: true,
      }),
    }).toEqual({
      author: "open-author",
      prWaitFlagged: "reopen-for-review",
      prWaitUnflagged: "none",
      prWaitCleared: "none",
      authorNoPlan: "none",
      ciCheck: "none",
    });
  });
});

describe("reopenPlanOnPark", () => {
  it("asks lore-api to open plan p1 of re-cinq/lore when its line parks on the feature_review author", async () => {
    const { opened, reopened, merged, react } = recordingOpener();

    await react(run({ plan_id: "p1" }), node("author", "feature_review"));

    expect({ opened, reopened, merged }).toEqual({
      opened: [{ repo: "re-cinq/lore", planId: "p1" }],
      reopened: [],
      merged: [],
    });
  });

  it("asks lore-api to reopen plan p1 as spec-writer and clears spec_review_reopen on run-1 when its flagged line parks on the pr_review wait", async () => {
    const { opened, reopened, merged, react } = recordingOpener();

    await react(
      run({ plan_id: "p1", spec_review_reopen: true }),
      node("merged", "pr_review"),
    );

    expect({ opened, reopened, merged }).toEqual({
      opened: [],
      reopened: [{ repo: "re-cinq/lore", planId: "p1", actor: "spec-writer" }],
      merged: [{ id: "run-1", patch: { spec_review_reopen: null } }],
    });
  });

  it("asks nothing for an unflagged pr_review park, nor a feature_review park on a run with no plan", async () => {
    const { opened, reopened, merged, react } = recordingOpener();

    await react(run({ plan_id: "p1" }), node("merged", "pr_review"));
    await react(run({}), node("author", "feature_review"));

    expect({ opened, reopened, merged }).toEqual({
      opened: [],
      reopened: [],
      merged: [],
    });
  });
});
