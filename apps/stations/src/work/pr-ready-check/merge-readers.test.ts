import { describe, expect, it } from "vitest";
import type { CheckRun } from "@re-cinq/lore-shared/project/pulls/pull-requests-port.js";
import {
  CONFLICT_SUMMARY,
  mergeReportForRun,
  type MergeWaitDeps,
} from "./merge-readers.js";
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
    failedJob: async () => null,
    hasCiHistory: async () => true,
    listReviewThreads: async () => [],
    countOpenReviewRuns: async () => 0,
    pullFacts: async () => ({
      createdAt: "2026-10-22T06:00:00Z",
      mergeable: true,
    }),
    listReviewComments: async () => [],
    latestReviewBody: async () => null,
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

  it("sends the open thread on src/a.ts:3 to the fix as its comment id, place, author and text", async () => {
    const report = await mergeReportForRun(
      RUN,
      deps({
        listReviewThreads: async () => [
          {
            id: "T1",
            isResolved: false,
            isOutdated: false,
            comments: [{ databaseId: 9 }],
          },
        ],
        listReviewComments: async () => [
          {
            id: 9,
            path: "src/a.ts",
            line: 3,
            body: "Rename this.",
            user: "gedaiu",
            created_at: "2026-10-22T07:00:00Z",
          },
        ],
      }),
    );

    expect(report).toEqual({
      outcome: "changes_requested",
      args: {
        reason: "unresolved_threads",
        review_feedback:
          "inline comment 9 on src/a.ts:3 (gedaiu):\nRename this.",
      },
    });
  });

  it("sends #42, which conflicts with its base, to the fix with the conflict named as what failed on abc", async () => {
    const report = await mergeReportForRun(
      RUN,
      deps({
        pullFacts: async () => ({
          createdAt: "2026-10-22T06:00:00Z",
          mergeable: false,
        }),
      }),
    );

    expect(report).toEqual({
      outcome: "changes_requested",
      args: {
        reason: "pr_conflicting",
        ci_feedback_sha: "abc",
        ci_failed_checks: "merge conflict with the base branch",
        ci_failure_summary: CONFLICT_SUMMARY,
      },
    });
  });
});
