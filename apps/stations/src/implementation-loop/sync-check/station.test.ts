import { describe, expect, it } from "vitest";
import type { Tools } from "@re-cinq/floor-station";
import type {
  BranchUpdate,
  Mergeability,
} from "@re-cinq/lore-shared/project/pulls/pull-requests-port.js";
import { syncCheckHandle } from "./station.js";

const TOOLS: Tools = {
  read: () => Promise.resolve(Buffer.from("")),
  produce: () => Promise.resolve(),
  modelCall: () => Promise.resolve(),
  signal: new AbortController().signal,
};

const BRANCH = "lore/implementation-loop/issue-77";

function brief() {
  return {
    visitId: "visit-sync-check",
    iteration: 1,
    needs: { target: `https://github.com/re-cinq/app@${BRANCH}` },
  };
}

function checkWith(
  behindBy: number | undefined,
  pull: Mergeability | null = null,
  rebase: BranchUpdate = { updated: false, reason: "no pull request" },
) {
  const rebased: string[] = [];
  const handle = syncCheckHandle({
    behindBy: (repo, branch) =>
      repo === "re-cinq/app" && branch === BRANCH
        ? Promise.resolve(behindBy)
        : Promise.reject(new Error(`Not Found: ${repo}@${branch}`)),
    pullMergeability: () => Promise.resolve(pull),
    rebaseOnGitHub: (_repo, branch) => {
      rebased.push(branch);

      return Promise.resolve(rebase);
    },
  });

  return Object.assign(handle, { rebased });
}

describe("loop-sync-check", () => {
  it("reports success when the branch lacks no commit of main", async () => {
    expect(await checkWith(0)(brief(), TOOLS)).toEqual({ outcome: "success" });
  });

  it("asks for a rebase when the branch lacks 3 commits of main", async () => {
    expect(await checkWith(3)(brief(), TOOLS)).toEqual({
      outcome: "changes_requested",
    });
  });

  it("reports failed when GitHub cannot compare the branch", async () => {
    expect(await checkWith(undefined)(brief(), TOOLS)).toEqual({
      outcome: "failed",
      error: `could not compare ${BRANCH} with the default branch`,
    });
  });

  it("reports failed with the error when the lookup throws", async () => {
    const handle = syncCheckHandle({
      behindBy: () => Promise.reject(new Error("Bad credentials")),
      pullMergeability: () => Promise.resolve(null),
      rebaseOnGitHub: () => Promise.resolve({ updated: true }),
    });

    expect(await handle(brief(), TOOLS)).toEqual({
      outcome: "failed",
      error: "Bad credentials",
    });
  });
});

describe("loop-sync-check on a branch with an open pull request", () => {
  it("reports success for a pull request 4 commits behind main that GitHub calls clean, since no branch rule asks for it up to date", async () => {
    expect(
      await checkWith(4, { mergeable: true, state: "clean" })(brief(), TOOLS),
    ).toEqual({ outcome: "success" });
  });

  it("asks for a rebase when GitHub calls the pull request behind and cannot rebase it itself, and when it conflicts", async () => {
    expect([
      await checkWith(4, { mergeable: true, state: "behind" })(brief(), TOOLS),
      await checkWith(4, { mergeable: false, state: "dirty" })(brief(), TOOLS),
    ]).toEqual([
      {
        outcome: "changes_requested",
        error: "GitHub could not rebase it: no pull request",
      },
      { outcome: "changes_requested" },
    ]);
  });
});

describe("loop-sync-check rebasing a pull request GitHub calls behind without a pod", () => {
  it("has GitHub rebase a clean pull request a rule wants up to date, and reports success with no sync round (502 sync-pr-rebase pods over the weekend of 2026-10-23, 129 of them failed, most with nothing to resolve)", async () => {
    const check = checkWith(
      4,
      { mergeable: true, state: "behind" },
      { updated: true },
    );

    expect({
      verdict: await check(brief(), TOOLS),
      rebased: check.rebased,
    }).toEqual({
      verdict: { outcome: "success" },
      rebased: [BRANCH],
    });
  });

  it("asks for the sync round when GitHub refuses the rebase, naming why", async () => {
    const check = checkWith(
      4,
      { mergeable: true, state: "behind" },
      { updated: false, reason: "merge conflict between base and head" },
    );

    expect({
      verdict: await check(brief(), TOOLS),
      rebased: check.rebased,
    }).toEqual({
      verdict: {
        outcome: "changes_requested",
        error:
          "GitHub could not rebase it: merge conflict between base and head",
      },
      rebased: [BRANCH],
    });
  });

  it("asks GitHub for no rebase of a pull request in conflict, which only the sync round settles", async () => {
    const check = checkWith(
      4,
      { mergeable: false, state: "dirty" },
      { updated: true },
    );

    expect({
      verdict: await check(brief(), TOOLS),
      rebased: check.rebased,
    }).toEqual({
      verdict: { outcome: "changes_requested" },
      rebased: [],
    });
  });
});
