import { describe, expect, it } from "vitest";
import { ensurePull, type PullOpener } from "./ensure-pull.js";
import type { PullDraft, PullRef } from "./pull-requests-port.js";

const DRAFT: PullDraft = { title: "Add export", body: "body", draft: true };

function pullRef(branch: string, number: number): PullRef {
  return {
    repo: "re-cinq/app",
    number,
    title: "Add export",
    branch,
    state: "open",
    labels: [],
    url: `https://github.com/re-cinq/app/pull/${number}`,
  };
}

function pullsHolding(open: PullRef[]) {
  const opened: Array<{ branch: string; pr: PullDraft }> = [];
  const pulls: PullOpener = {
    list: () => Promise.resolve(open),
    open: (branch, pr) => {
      opened.push({ branch, pr });

      return Promise.resolve(pullRef(branch, 43));
    },
  };

  return { pulls, opened };
}

describe("ensurePull", () => {
  it("opens pull request 43 from lore/x when no pull request is open on that branch", async () => {
    const { pulls, opened } = pullsHolding([pullRef("other", 7)]);

    expect((await ensurePull(pulls, "lore/x", DRAFT)).number).toBe(43);
    expect(opened).toEqual([{ branch: "lore/x", pr: DRAFT }]);
  });

  it("answers pull request 42 already open on lore/x and opens nothing", async () => {
    const { pulls, opened } = pullsHolding([pullRef("lore/x", 42)]);

    expect((await ensurePull(pulls, "lore/x", DRAFT)).number).toBe(42);
    expect(opened).toEqual([]);
  });
});
