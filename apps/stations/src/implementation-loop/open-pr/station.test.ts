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
      target: `https://github.com/re-cinq/app@${BRANCH}`,
      task_id: "task-1",
      ...needs,
    },
  };
}

const PLACEHOLDER = "_Written by the ready-for-review round._";
const REQUIRED_SECTIONS = `## Why\n\n${PLACEHOLDER}\n\n## What Changed\n\n${PLACEHOLDER}\n\n## Testing\n\n${PLACEHOLDER}`;

function scene(
  open: (pr: PullDraft) => Promise<PullRef> = () => Promise.resolve(pullRef()),
  template: string | null = null,
  alreadyOpen: PullRef[] = [],
) {
  const opened: PullDraft[] = [];
  const updated: Array<{ number: number; body: string }> = [];
  const recorded: Array<[string, PullRef]> = [];
  const handle = openLoopPrHandle({
    recordPr: async (taskId, pr) => {
      recorded.push([taskId, pr]);
    },
    template: (repo, branch) =>
      repo === "re-cinq/app" && branch === BRANCH
        ? Promise.resolve(template)
        : Promise.reject(new Error(`Not Found: ${repo}@${branch}`)),
    pulls: (repo) =>
      repo !== "re-cinq/app"
        ? Promise.reject(new Error(`Not Found: ${repo}`))
        : Promise.resolve({
            list: () => Promise.resolve(alreadyOpen),
            open: (_branch, pr) => {
              opened.push(pr);

              return open(pr);
            },
            update: (number, fields) => {
              updated.push({ number, body: fields.body });

              return Promise.resolve();
            },
          }),
  });

  return { handle, opened, updated, recorded };
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
        body: `Opened by the Lore implementation loop from \`${BRANCH}\`.\n\n${REQUIRED_SECTIONS}\n\nCloses #77\nLore-Task: task-1`,
        draft: true,
      },
    ]);
  });

  it("titles the pull request after the branch when the run carries no issue title", async () => {
    const { handle, opened } = scene();

    await handle(brief(), TOOLS);

    expect(opened[0]).toMatchObject({
      title: `lore: ${BRANCH}`,
      body: `Opened by the Lore implementation loop from \`${BRANCH}\`.\n\n${REQUIRED_SECTIONS}\n\nLore-Task: task-1`,
    });
  });

  it("produces the pull request's url as pr_url", async () => {
    const { handle } = scene();

    expect(await handle(brief(), TOOLS)).toEqual({
      outcome: "success",
      produced: { pr_url: PR_URL },
    });
  });

  it("records pull request 42 on task-1, where the run page reads it", async () => {
    const { handle, recorded } = scene();

    await handle(brief(), TOOLS);

    expect(recorded).toEqual([["task-1", pullRef()]]);
  });

  it("records nothing on the task when no pull request could be opened", async () => {
    const { handle, recorded } = scene(() =>
      Promise.reject(new Error("Bad credentials")),
    );

    await handle(brief(), TOOLS);

    expect(recorded).toEqual([]);
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

  it("opens the draft with the ## headings of the branch's pull request template, so a description check passes before the prose is written", async () => {
    const { handle, opened } = scene(
      undefined,
      "## Why\n\ntext\n\n## Testing\n\ntext\n",
    );

    await handle(brief({ issue_number: "77" }), TOOLS);

    expect(opened[0]?.body).toEqual(
      `Opened by the Lore implementation loop from \`${BRANCH}\`.\n\n## Why\n\n${PLACEHOLDER}\n\n## Testing\n\n${PLACEHOLDER}\n\nCloses #77\nLore-Task: task-1`,
    );
  });

  it("gives a reused draft whose body lacks the sections the draft body, so the description check passes on the next push", async () => {
    const draft = { ...pullRef(), draft: true, body: "Opened by the loop." };
    const { handle, opened, updated } = scene(undefined, null, [draft]);

    await handle(brief({ issue_number: "77" }), TOOLS);

    expect({ opened, updated }).toEqual({
      opened: [],
      updated: [
        {
          number: 42,
          body: `Opened by the Lore implementation loop from \`${BRANCH}\`.\n\n${REQUIRED_SECTIONS}\n\nCloses #77\nLore-Task: task-1`,
        },
      ],
    });
  });

  it("leaves a reused pull request alone when it is out of draft or already carries every section", async () => {
    const ready = { ...pullRef(), draft: false, body: "Opened by the loop." };
    const complete = { ...pullRef(), draft: true, body: REQUIRED_SECTIONS };
    const outOfDraft = scene(undefined, null, [ready]);
    const sectioned = scene(undefined, null, [complete]);

    await outOfDraft.handle(brief(), TOOLS);
    await sectioned.handle(brief(), TOOLS);

    expect([outOfDraft.updated, sectioned.updated]).toEqual([[], []]);
  });
});
