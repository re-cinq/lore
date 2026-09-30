import { describe, expect, it } from "vitest";
import type { Tools } from "@re-cinq/floor-station";
import type { RunView } from "@re-cinq/floor-client";
import type { CheckRunInput } from "@re-cinq/lore-shared/project/lib/github-port.js";
import { runSettledHandle, type RunSettledDeps } from "./station.js";

const PR_URL = "https://github.com/re-cinq/lore/pull/412";

const TOOLS: Tools = {
  read: () => Promise.resolve(Buffer.from("")),
  produce: () => Promise.resolve(),
  modelCall: () => Promise.resolve(),
  signal: new AbortController().signal,
};

function brokenRun(headSha?: string): RunView {
  return {
    id: "run-1",
    lineId: "code-review",
    lineHash: "hash",
    repo: "github.com/re-cinq/lore",
    subjectKey: null,
    startItems: {
      pr_url: { kind: "value", ref: PR_URL, by: "lore" },
      ...(headSha
        ? { head_sha: { kind: "value", ref: headSha, by: "lore" } }
        : {}),
    },
    outcome: "error",
    reason: "post-review: failed",
    finishedAt: "2026-09-30T10:00:00.000Z",
  };
}

function scene(settled: RunView | null, pullHeadSha?: string) {
  const checks: CheckRunInput[] = [];
  const repos: string[] = [];
  const deps: RunSettledDeps = {
    run: () => Promise.resolve(settled),
    project: (repo) => {
      repos.push(repo);

      return Promise.resolve({
        pullHead: () => Promise.resolve({ headSha: pullHeadSha }),
        upsertCheckRun: (input) => {
          checks.push(input);

          return Promise.resolve();
        },
      });
    },
  };

  return { handle: runSettledHandle(deps), checks, repos };
}

function brief(lineId: string, outcome: string) {
  return {
    visitId: "visit-1",
    iteration: 1,
    needs: { run_id: "run-1", line_id: lineId, outcome },
  };
}

describe("runSettledHandle", () => {
  it("fails the check on sha-1 of re-cinq/lore for a code-review run settled as error", async () => {
    const { handle, checks, repos } = scene(brokenRun("sha-1"));

    await handle(brief("code-review", "error"), TOOLS);

    expect(repos).toEqual(["re-cinq/lore"]);
    expect(checks).toMatchObject([{ headSha: "sha-1", conclusion: "failure" }]);
  });

  it("reads the head sha off the pull request when the run was started without one", async () => {
    const { handle, checks } = scene(brokenRun(), "sha-live");

    await handle(brief("code-review", "error"), TOOLS);

    expect(checks).toMatchObject([{ headSha: "sha-live" }]);
  });

  it("publishes nothing for a code-review run settled as success", async () => {
    const { handle, checks } = scene(brokenRun("sha-1"));

    expect(await handle(brief("code-review", "success"), TOOLS)).toEqual({
      outcome: "success",
    });
    expect(checks).toEqual([]);
  });

  it("publishes nothing when the floor no longer has the run", async () => {
    const { handle, checks } = scene(null);

    await handle(brief("code-review", "error"), TOOLS);

    expect(checks).toEqual([]);
  });

  it("publishes nothing for a walk-note run settled as error", async () => {
    const { handle, checks } = scene(brokenRun("sha-1"));

    await handle(brief("walk-note", "error"), TOOLS);

    expect(checks).toEqual([]);
  });
});
