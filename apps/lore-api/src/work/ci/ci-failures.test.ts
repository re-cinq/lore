import { describe, it, expect } from "vitest";
import type {
  CheckRun,
  JobFailure,
  PullCommit,
} from "@re-cinq/lore-shared/project/pulls/pull-requests-port.js";
import { readCiFailures, type CiPulls } from "./ci-failures.js";

const failure: JobFailure = {
  annotations: [
    'specs/testing-standards/spec.md:7 Status "draft" does not match',
  ],
  steps: ["Prettier + eslint --fix"],
  tail: ["✖ 10540 problems (1 error, 10539 warnings)"],
};

function pulls(over: Partial<CiPulls> = {}): CiPulls & { asked: string[] } {
  const asked: string[] = [];

  return {
    asked,
    get: async (number) =>
      number === 1684
        ? {
            repo: "re-cinq/lore",
            number,
            title: "t",
            branch: "lore/implementation-loop/issue-1510",
            state: "open",
            labels: [],
            url: "u",
          }
        : null,
    listBranchCommits: async (branch, limit): Promise<PullCommit[]> => {
      asked.push(`commits ${branch} ${limit}`);

      return [
        { sha: "1b8abc7f", message: "feat: round 4", date: "t" },
        { sha: "eeda8ca2", message: "style: prettier [skip ci]", date: "t" },
      ];
    },
    listChecks: async (ref): Promise<CheckRun[]> => {
      asked.push(`checks ${ref}`);

      return [
        {
          id: 102476456760,
          app: "github-actions",
          name: "format",
          status: "completed",
          conclusion: "failure",
          output: { title: null, summary: null },
        },
        {
          id: 1,
          app: "github-actions",
          name: "charts",
          status: "completed",
          conclusion: "success",
        },
      ];
    },
    failedJob: async (jobId) => {
      asked.push(`job ${jobId}`);

      return failure;
    },
    ...over,
  };
}

describe("readCiFailures", () => {
  it("judges the branch's newest non-skip-ci commit and explains each failed check from its job", async () => {
    const p = pulls();

    expect({
      report: await readCiFailures(p, {
        branch: "lore/implementation-loop/issue-1510",
      }),
      asked: p.asked,
    }).toEqual({
      report: {
        branch: "lore/implementation-loop/issue-1510",
        judged_sha: "1b8abc7f",
        conclusion: "failure",
        failures: [
          {
            name: "format",
            app: "github-actions",
            job_id: 102476456760,
            ...failure,
          },
        ],
      },
      asked: [
        "commits lore/implementation-loop/issue-1510 30",
        "checks 1b8abc7f",
        "job 102476456760",
      ],
    });
  });

  it("resolves a pull request number to its head branch, so a caller holding only the number is served too", async () => {
    const p = pulls();

    expect((await readCiFailures(p, { prNumber: 1684 }))?.branch).toBe(
      "lore/implementation-loop/issue-1510",
    );
  });

  it("returns null for a pull request GitHub does not have", async () => {
    expect(await readCiFailures(pulls(), { prNumber: 9 })).toBe(null);
  });

  it("reports none, reading no checks, when every commit on the branch skipped CI", async () => {
    const p = pulls({
      listBranchCommits: async () => [
        { sha: "a", message: "style: prettier [skip ci]", date: "t" },
      ],
    });

    expect({
      report: await readCiFailures(p, { branch: "topic" }),
      asked: p.asked,
    }).toEqual({
      report: {
        branch: "topic",
        judged_sha: null,
        conclusion: "none",
        failures: [],
      },
      asked: [],
    });
  });
});
