import { describe, expect, it } from "vitest";
import type { PullRef } from "@re-cinq/lore-shared/project/pulls/pull-requests-port.js";
import {
  autoMergeTick,
  headKey,
  type AutoMergeTickDeps,
} from "./auto-merge-tick.js";

const REPO = "acme/widgets";

const pull = (number: number, over: Partial<PullRef> = {}): PullRef => ({
  repo: REPO,
  number,
  title: `Change ${number}`,
  branch: `b${number}`,
  state: "open",
  labels: [],
  url: `https://github.com/${REPO}/pull/${number}`,
  draft: false,
  headRepo: REPO,
  ...over,
});

function scene(opts: {
  pulls: PullRef[];
  passed?: number[];
  worked?: string[];
  repos?: string[];
}) {
  const started: number[] = [];
  const deps: AutoMergeTickDeps = {
    repos: async () => opts.repos ?? [REPO],
    openPulls: async () => opts.pulls,
    reviewPassed: async (_repo, p) => (opts.passed ?? []).includes(p.number),
    workedPulls: async () => new Set(opts.worked ?? []),
    start: async (_repo, p) => {
      started.push(p.number);
    },
  };

  return { deps, started };
}

describe("autoMergeTick", () => {
  it("starts a run for #1 whose review passed, and none for #2 still unreviewed", async () => {
    const { deps, started } = scene({ pulls: [pull(1), pull(2)], passed: [1] });

    expect({ summary: await autoMergeTick(deps), started }).toEqual({
      summary: "auto-merge-tick: 1 repo(s), started 1 run(s)",
      started: [1],
    });
  });

  it("skips a draft, a fork's pull request, and one a run is already working", async () => {
    const { deps, started } = scene({
      pulls: [
        pull(3, { draft: true }),
        pull(4, { headRepo: "someone/widgets" }),
        pull(5),
      ],
      passed: [3, 4, 5],
      worked: [`https://github.com/${REPO}/pull/5`],
    });

    await autoMergeTick(deps);

    expect(started).toEqual([]);
  });

  it("leaves #6, whose head def a settled run already worked, and starts #7, pushed to since its run", async () => {
    const { deps, started } = scene({
      pulls: [pull(6, { headSha: "def" }), pull(7, { headSha: "new" })],
      passed: [6, 7],
      worked: [
        headKey(`https://github.com/${REPO}/pull/6`, "def"),
        headKey(`https://github.com/${REPO}/pull/7`, "old"),
      ],
    });

    await autoMergeTick(deps);

    expect(started).toEqual([7]);
  });

  it("starts at most 3 runs per repo in one tick", async () => {
    const { deps, started } = scene({
      pulls: [pull(1), pull(2), pull(3), pull(4)],
      passed: [1, 2, 3, 4],
    });

    await autoMergeTick(deps);

    expect(started).toEqual([1, 2, 3]);
  });
});
