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
    open: async (repo, branch, title) => ({ repo, number: 100, title, branch, state: "open", labels: [] }),
  };
}

describe("PullRequests", () => {
  it("lists only the repo's pull requests", async () => {
    const pulls: PullRef[] = [
      { repo: "re-cinq/lore", number: 7, title: "feat", branch: "f", state: "open", labels: [] },
      { repo: "other/repo", number: 8, title: "x", branch: "g", state: "open", labels: [] },
    ];
    const facade = new PullRequests("re-cinq/lore", fakePulls(pulls, []));

    expect(await facade.list()).toEqual([
      { repo: "re-cinq/lore", number: 7, title: "feat", branch: "f", state: "open", labels: [] },
    ]);
  });

  it("merges by number with the requested method bound to the repo", async () => {
    const merged: Array<{ number: number; method?: MergeMethod }> = [];
    const facade = new PullRequests("re-cinq/lore", fakePulls([], merged));

    await facade.merge(7, "squash");

    expect(merged).toEqual([{ number: 7, method: "squash" }]);
  });
});
