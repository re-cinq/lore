import { describe, it, expect } from "vitest";
import type { AssemblyRunRecord } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-port.js";
import type { RunGraphNode } from "@re-cinq/lore-shared/project/assembly-runs/run-graph.js";
import { openPlanForAuthor } from "./plan-author-waiting.js";

const run = (args: Record<string, unknown>) =>
  ({ id: "run-1", repo: "re-cinq/lore", args }) as AssemblyRunRecord;

const node = (id: string, type: string) => ({ id, type }) as RunGraphNode;

const recordingOpener = () => {
  const opened: Array<{ repo: string; planId: string }> = [];

  return {
    opened,
    react: openPlanForAuthor({
      openForAuthor: async (repo, planId) => void opened.push({ repo, planId }),
    }),
  };
};

describe("openPlanForAuthor", () => {
  it("asks lore-api to open plan p1 of re-cinq/lore when its line parks on the feature_review author", async () => {
    const { opened, react } = recordingOpener();

    await react(run({ plan_id: "p1" }), node("author", "feature_review"));

    expect(opened).toEqual([{ repo: "re-cinq/lore", planId: "p1" }]);
  });

  it("asks nothing for a pr_review park, nor a feature_review park on a run with no plan", async () => {
    const { opened, react } = recordingOpener();

    await react(run({ plan_id: "p1" }), node("merged", "pr_review"));
    await react(run({}), node("author", "feature_review"));

    expect(opened).toEqual([]);
  });
});
