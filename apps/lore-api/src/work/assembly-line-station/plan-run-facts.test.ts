import { describe, expect, it } from "vitest";
import type { AssemblyRunSummary } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-port.js";
import { readPlanRunFacts } from "./plan-run-facts.js";

const RUN = {
  id: "run-1",
  blueprintName: "feature-planning",
  taskId: null,
  repo: "o/r",
  branch: null,
  subjectKey: "plan_id:p1",
  args: {
    engine: "floor",
    pr_number: 7,
    story_issue: "4",
    spec_plan: JSON.stringify({ summary: "Which checkout flow?" }),
  },
  status: "running",
  outcome: null,
  reason: null,
  createdAt: new Date("2026-11-06T10:00:00Z"),
  startedAt: null,
  finishedAt: null,
} as unknown as AssemblyRunSummary;

describe("readPlanRunFacts", () => {
  it("reads run-1's story #4, the analysis's question and spec PR #7's title and threads", async () => {
    const facts = await readPlanRunFacts(RUN, async () => ({
      title: "Spec: checkout",
      unresolved_threads: 2,
    }));

    expect(facts).toEqual({
      id: "run-1",
      status: "running",
      outcome: null,
      reason: null,
      issue_url: "https://github.com/o/r/issues/4",
      issue_number: 4,
      pr_url: "https://github.com/o/r/pull/7",
      pr_number: 7,
      pr_title: "Spec: checkout",
      pr_unresolved_threads: 2,
      spec_plan_summary: "Which checkout flow?",
    });
  });

  it("keeps run-1's facts without the PR's title and threads when GitHub fails", async () => {
    const facts = await readPlanRunFacts(RUN, async () => {
      throw new Error("GitHub API 502");
    });

    expect(facts).toMatchObject({
      id: "run-1",
      pr_number: 7,
      pr_title: null,
      pr_unresolved_threads: null,
    });
  });

  it("asks GitHub nothing for a run with no spec PR", async () => {
    let asked = false;
    const facts = await readPlanRunFacts(
      { ...RUN, args: { engine: "floor" } },
      async () => {
        asked = true;

        return null;
      },
    );

    expect({ asked, pr_number: facts.pr_number, pr_url: facts.pr_url }).toEqual(
      {
        asked: false,
        pr_number: null,
        pr_url: null,
      },
    );
  });
});
