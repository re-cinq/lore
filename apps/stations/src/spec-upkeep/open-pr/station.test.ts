import { describe, expect, it } from "vitest";
import type { Tools } from "@re-cinq/floor-station";
import type {
  PullDraft,
  PullRef,
} from "@re-cinq/lore-shared/project/pulls/pull-requests-port.js";
import { openUpkeepPrHandle } from "./station.js";

const BRANCH = "lore/spec-upkeep/2026-10-05";
const PR_URL = "https://github.com/acme/widgets/pull/42";

function tools(prBody: string): Tools {
  return {
    read: () => Promise.resolve(Buffer.from(prBody)),
    produce: () => Promise.resolve(),
    modelCall: () => Promise.resolve(),
    signal: new AbortController().signal,
  };
}

function brief(needs: Record<string, string> = {}) {
  return {
    visitId: "visit-open-pr",
    iteration: 1,
    needs: { target: `https://github.com/acme/widgets@${BRANCH}`, ...needs },
  };
}

function scene(refusal?: Error) {
  const opened: PullDraft[] = [];
  const handle = openUpkeepPrHandle({
    pulls: (repo) =>
      repo !== "acme/widgets"
        ? Promise.reject(new Error(`Not Found: ${repo}`))
        : Promise.resolve({
            list: () => Promise.resolve([]),
            open: (_branch: string, pr: PullDraft) => {
              opened.push(pr);

              return refusal
                ? Promise.reject(refusal)
                : Promise.resolve(pullRef());
            },
          }),
  });

  return { handle, opened };
}

function pullRef(): PullRef {
  return {
    repo: "acme/widgets",
    number: 42,
    title: "Spec upkeep 2026-10-05",
    branch: BRANCH,
    state: "open",
    labels: [],
    url: PR_URL,
  };
}

describe("the spec-upkeep-open-pr station", () => {
  it("opens the pull request titled after the run's day with the description the agent wrote", async () => {
    const { handle, opened } = scene();

    const report = await handle(
      brief({ pr_body: "blob-body" }),
      tools("Two statements updated.\n"),
    );

    expect(opened).toEqual([
      {
        title: "Spec upkeep 2026-10-05: drift fixes and test links",
        body: "Two statements updated.",
      },
    ]);
    expect(report).toEqual({
      outcome: "success",
      produced: { pr_url: PR_URL },
    });
  });

  it("writes a default description when the agent wrote none", async () => {
    const { handle, opened } = scene();

    await handle(brief(), tools(""));

    expect(opened[0].body).toBe(
      "Lore's weekly spec upkeep: statements that had drifted from the code are updated, and statements a test already validates are linked to it. The two are separate commits.",
    );
  });

  it("reports nothing when the agent left the branch with no commit", async () => {
    const { handle } = scene(
      new Error("Validation Failed: No commits between main and x"),
    );

    expect(await handle(brief(), tools(""))).toEqual({ outcome: "nothing" });
  });

  it("reports failed with the error when GitHub refuses for any other reason", async () => {
    const { handle } = scene(new Error("Bad credentials"));

    expect(await handle(brief(), tools(""))).toEqual({
      outcome: "failed",
      error: "Bad credentials",
    });
  });
});
