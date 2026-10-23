import { describe, expect, it } from "vitest";
import type { CheckRun } from "@re-cinq/lore-shared/project/pulls/pull-requests-port.js";
import { mergeReportForRun, type MergeWaitDeps } from "./merge-readers.js";
import type { LoopRunSlice } from "./sweep-contract.js";

const RUN: LoopRunSlice = {
  id: "run-merge",
  blueprintName: "auto-merge",
  repo: "re-cinq/app",
  status: "running",
  args: { pr_number: 42 },
  graph: null,
};

const NOW = Date.parse("2026-10-23T12:00:00Z");

const check = (name: string, conclusion: string): CheckRun => ({
  id: name.length,
  name,
  status: "completed",
  conclusion,
});

function deps(over: Partial<MergeWaitDeps> = {}): MergeWaitDeps {
  return {
    listPrCommits: async () => [
      { sha: "abc", message: "fix", parents: [] } as never,
    ],
    listChecks: async () => [
      check("build", "success"),
      check("lore/code-review", "success"),
    ],
    hasCiHistory: async () => true,
    listReviewThreads: async () => [],
    countOpenReviewRuns: async () => 0,
    pullFacts: async () => ({
      createdAt: "2026-10-22T06:00:00Z",
      mergeable: true,
    }),
    minAgeHours: async () => 24,
    now: () => NOW,
    ...over,
  };
}

describe("mergeReportForRun", () => {
  it("reports success for #42, green, approved by Lore's review and opened 30 hours ago", async () => {
    expect(await mergeReportForRun(RUN, deps())).toEqual({
      outcome: "success",
      args: {},
    });
  });

  it("stays silent for #42 opened 6 hours ago against the 24 hour minimum", async () => {
    expect(
      await mergeReportForRun(
        RUN,
        deps({
          pullFacts: async () => ({
            createdAt: "2026-10-23T06:00:00Z",
            mergeable: true,
          }),
        }),
      ),
    ).toBeNull();
  });

  it("stays silent for #42 while a review thread is open, and while its build is red", async () => {
    const threadOpen = deps({
      listReviewThreads: async () => [
        {
          id: "T1",
          isResolved: false,
          isOutdated: false,
          comments: [{ databaseId: 9 }],
        },
      ],
    });
    const buildRed = deps({
      listChecks: async () => [
        check("build", "failure"),
        check("lore/code-review", "success"),
      ],
    });

    expect([
      await mergeReportForRun(RUN, threadOpen),
      await mergeReportForRun(RUN, buildRed),
    ]).toEqual([null, null]);
  });

  it("stays silent for #42, which conflicts with its base, instead of sending it to a fix", async () => {
    expect(
      await mergeReportForRun(
        RUN,
        deps({
          pullFacts: async () => ({
            createdAt: "2026-10-22T06:00:00Z",
            mergeable: false,
          }),
        }),
      ),
    ).toBeNull();
  });
});
