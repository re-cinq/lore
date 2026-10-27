import { describe, expect, it } from "vitest";
import type { Octokit } from "octokit";
import { mergedPullsTouching } from "./platform-github-pulls-touching.js";

const pr = (number: number, mergedAt: string | null) => ({
  number,
  title: `Change ${number}`,
  state: "closed",
  html_url: `https://github.com/re-cinq/otto/pull/${number}`,
  head: { ref: `fix/${number}` },
  base: { ref: "main" },
  labels: [],
  merged_at: mergedAt,
  body: null,
  user: { login: "gedaiu" },
});

const MERGED = "2026-10-20T10:00:00Z";

function github() {
  const asked: unknown[] = [];
  const repos = {
    listCommits: async (params: unknown) => {
      asked.push(params);

      return { data: [{ sha: "c1" }, { sha: "c2" }] };
    },
    listPullRequestsAssociatedWithCommit: async ({
      commit_sha: sha,
    }: {
      commit_sha: string;
    }) => ({
      data: sha === "c1" ? [pr(57, MERGED), pr(58, null)] : [pr(57, MERGED)],
    }),
  };

  return { ok: { rest: { repos } } as unknown as Octokit, asked };
}

describe("mergedPullsTouching", () => {
  it("reads the 20 newest commits touching src/a.ts and answers each merged pull request behind them once, leaving out the unmerged one", async () => {
    const { ok, asked } = github();
    const pulls = await mergedPullsTouching(ok, "re-cinq/otto", "src/a.ts");

    expect({
      numbers: pulls.map((pull) => [pull.number, pull.state]),
      asked,
    }).toEqual({
      numbers: [[57, "merged"]],
      asked: [
        { owner: "re-cinq", repo: "otto", path: "src/a.ts", per_page: 20 },
      ],
    });
  });
});
