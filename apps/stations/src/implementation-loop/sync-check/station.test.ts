import { describe, expect, it } from "vitest";
import type { Tools } from "@re-cinq/floor-station";
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

function checkWith(behindBy: number | undefined) {
  return syncCheckHandle({
    behindBy: (repo, branch) =>
      repo === "re-cinq/app" && branch === BRANCH
        ? Promise.resolve(behindBy)
        : Promise.reject(new Error(`Not Found: ${repo}@${branch}`)),
  });
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
    });

    expect(await handle(brief(), TOOLS)).toEqual({
      outcome: "failed",
      error: "Bad credentials",
    });
  });
});
