import { describe, expect, it } from "vitest";
import type { Octokit } from "octokit";
import { updateBranch } from "./platform-github-pulls-write.js";

interface Call {
  query: string;
  vars: Record<string, unknown>;
}

function github(node: { id: string } | null, refusal?: Error) {
  const calls: Call[] = [];
  const graphql = async (query: string, vars: Record<string, unknown>) => {
    calls.push({ query, vars });

    if (query.includes("updatePullRequestBranch") && refusal) {
      throw refusal;
    }

    return { repository: { pullRequest: node && { ...node, isDraft: false } } };
  };

  return { ok: { graphql } as unknown as Octokit, calls };
}

describe("updateBranch", () => {
  it("asks GitHub to rebase pull request node PR_42 onto its base, expecting head abc, and answers updated", async () => {
    const { ok, calls } = github({ id: "PR_42" });

    expect({
      answer: await updateBranch(ok, "re-cinq/lore", 7, "abc"),
      mutation: calls[1]?.query.includes("updatePullRequestBranch"),
      vars: calls[1]?.vars,
    }).toEqual({
      answer: { updated: true },
      mutation: true,
      vars: {
        pullRequestId: "PR_42",
        expectedHeadOid: "abc",
        updateMethod: "REBASE",
      },
    });
  });

  it("answers not updated with GitHub's reason when the rebase cannot be done, and throws nothing", async () => {
    const { ok } = github(
      { id: "PR_42" },
      new Error("merge conflict between base and head"),
    );

    expect(await updateBranch(ok, "re-cinq/lore", 7, "abc")).toEqual({
      updated: false,
      reason: "merge conflict between base and head",
    });
  });

  it("answers not updated for pull request 7 it cannot read, and sends no mutation", async () => {
    const { ok, calls } = github(null);

    expect({
      answer: await updateBranch(ok, "re-cinq/lore", 7, "abc"),
      calls: calls.length,
    }).toEqual({
      answer: { updated: false, reason: "pull request 7 not found" },
      calls: 1,
    });
  });
});
