import { describe, it, expect } from "vitest";
import { PullRequests } from "./pull-requests.js";
import type { PullRequestsPort, PullRef, MergeMethod } from "./pull-requests-port.js";

/**
 * project.pulls is canonical for all PR ops. The fake records the merge it was
 * asked for so we assert the repo is bound and the method passes through.
 */

function fakePulls(pulls: PullRef[], merged: Array<{ number: number; method?: MergeMethod }>): PullRequestsPort {
  return {
    list: async (repo) => pulls.filter((p) => p.repo === repo),
    get: async (repo, number) => pulls.find((p) => p.repo === repo && p.number === number) ?? null,
    comment: async () => {},
    review: async () => {},
    addLabel: async () => {},
    merge: async (_repo, number, method) => {
      merged.push({ number, method });
    },
    open: async (repo, branch, title) => ({ repo, number: 100, title, branch, state: "open", labels: [], url: "https://gh/pr/100" }),
    getDiff: async (_repo, number) => `diff for #${number}`,
    listReviews: async () => [{ id: 1, state: "APPROVED", body: "lgtm", user: "bot", submitted_at: "t" }],
    listComments: async () => [],
    listIssueComments: async () => [],
    listCommits: async () => [{ sha: "abc", message: "feat", date: "t" }],
    isMerged: async (_repo, number) => number === 7,
    isClosed: async () => false,
    getStats: async () => ({ files_changed: 1, additions: 2, deletions: 0, comments: 0, merged_at: null, created_at: "t" }),
    changedFileCount: async () => 1,
    ciConclusion: async () => "none" as const,
  };
}

describe("PullRequests", () => {
  it("lists only the repo's pull requests", async () => {
    const pulls: PullRef[] = [
      { repo: "re-cinq/lore", number: 7, title: "feat", branch: "f", state: "open", labels: [], url: "u7" },
      { repo: "other/repo", number: 8, title: "x", branch: "g", state: "open", labels: [], url: "u8" },
    ];
    const facade = new PullRequests("re-cinq/lore", fakePulls(pulls, []));

    expect(await facade.list()).toEqual([
      { repo: "re-cinq/lore", number: 7, title: "feat", branch: "f", state: "open", labels: [], url: "u7" },
    ]);
  });

  it("merges by number with the requested method bound to the repo", async () => {
    const merged: Array<{ number: number; method?: MergeMethod }> = [];
    const facade = new PullRequests("re-cinq/lore", fakePulls([], merged));

    await facade.merge(7, "squash");

    expect(merged).toEqual([{ number: 7, method: "squash" }]);
  });

  it("exposes PR reads bound to the repo and number", async () => {
    const facade = new PullRequests("re-cinq/lore", fakePulls([], []));

    expect(await facade.getDiff(3)).toBe("diff for #3");
    expect(await facade.listReviews(3)).toEqual([
      { id: 1, state: "APPROVED", body: "lgtm", user: "bot", submitted_at: "t" },
    ]);
    expect(await facade.isMerged(7)).toBe(true);
    expect(await facade.isMerged(3)).toBe(false);
  });
});
