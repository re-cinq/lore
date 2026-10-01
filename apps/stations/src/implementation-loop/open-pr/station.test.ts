import { describe, expect, it } from "vitest";
import type { Tools } from "@re-cinq/floor-station";
import type {
  PullDraft,
  PullRef,
} from "@re-cinq/lore-shared/project/pulls/pull-requests-port.js";
import { openLoopPrHandle } from "./station.js";

const TOOLS: Tools = {
  read: () => Promise.resolve(Buffer.from("")),
  produce: () => Promise.resolve(),
  modelCall: () => Promise.resolve(),
  signal: new AbortController().signal,
};

const BRANCH = "lore/implementation-loop/issue-77";
const PR_URL = "https://github.com/re-cinq/app/pull/42";

function brief(needs: Record<string, string> = {}) {
  return {
    visitId: "visit-open-pr",
    iteration: 1,
    needs: {
      target: `github.com/re-cinq/app@${BRANCH}`,
      task_id: "task-1",
      ...needs,
    },
  };
}

function pullRef(): PullRef {
  return {
    repo: "re-cinq/app",
    number: 42,
    title: "Add the export button",
    branch: BRANCH,
    state: "open",
    labels: [],
    url: PR_URL,
  };
}

function scene(
  open: (pr: PullDraft) => Promise<PullRef> = () => Promise.resolve(pullRef()),
) {
  const opened: PullDraft[] = [];
  const handle = openLoopPrHandle({
    pulls: () =>
      Promise.resolve({
        list: () => Promise.resolve([]),
        open: (_branch, pr) => {
          opened.push(pr);

          return open(pr);
        },
      }),
  });

  return { handle, opened };
}

describe("the loop-open-pr station", () => {
  it("opens a DRAFT pull request titled after issue 77, closing it and naming task-1", async () => {
    const { handle, opened } = scene();

    await handle(
      brief({ issue_title: "Add the export button", issue_number: "77" }),
      TOOLS,
    );

    expect(opened).toEqual([
      {
        title: "Add the export button",
        body: `Opened by the Lore implementation loop from \`${BRANCH}\`.\n\nCloses #77\nLore-Task: task-1`,
        draft: true,
      },
    ]);
  });

  it("titles the pull request after the branch when the run carries no issue title", async () => {
    const { handle, opened } = scene();

    await handle(brief(), TOOLS);

    expect(opened[0]).toMatchObject({
      title: `lore: ${BRANCH}`,
      body: `Opened by the Lore implementation loop from \`${BRANCH}\`.\n\nLore-Task: task-1`,
    });
  });

  it("produces the pull request's url as pr_url", async () => {
    const { handle } = scene();

    expect(await handle(brief(), TOOLS)).toEqual({
      outcome: "success",
      produced: { pr_url: PR_URL },
    });
  });

  it("reports failed naming the empty branch when the step before it pushed nothing", async () => {
    const { handle } = scene(() =>
      Promise.reject(
        new Error("Validation Failed: No commits between main and x"),
      ),
    );

    expect(await handle(brief(), TOOLS)).toEqual({
      outcome: "failed",
      error: `the step before pushed nothing: ${BRANCH} has no commits, so no pull request could be opened`,
    });
  });

  it("reports failed with the error when GitHub refuses for any other reason", async () => {
    const { handle } = scene(() =>
      Promise.reject(new Error("Bad credentials")),
    );

    expect(await handle(brief(), TOOLS)).toEqual({
      outcome: "failed",
      error: "Bad credentials",
    });
  });
});
