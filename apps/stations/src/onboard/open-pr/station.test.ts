import { describe, expect, it } from "vitest";
import type { Tools } from "@re-cinq/floor-station";
import type { PullRef } from "@re-cinq/lore-shared/project/pulls/pull-requests-port.js";
import { openOnboardPrHandle, type OpenOnboardPrDeps } from "./station.js";

const TOOLS: Tools = {
  read: () => Promise.resolve(Buffer.from("")),
  produce: () => Promise.resolve(),
  modelCall: () => Promise.resolve(),
  signal: new AbortController().signal,
};

const PR_URL = "https://github.com/re-cinq/app/pull/42";

function brief(attention = "") {
  return {
    visitId: "visit-open-pr",
    iteration: 1,
    needs: {
      target: "https://github.com/re-cinq/app@lore/onboard/app-1234abcd",
      task_id: "task-1",
      attention,
    },
  };
}

function pullRef(): PullRef {
  return {
    repo: "re-cinq/app",
    number: 42,
    title: "lore: onboard re-cinq/app",
    branch: "lore/onboard/app-1234abcd",
    state: "open",
    labels: [],
    url: PR_URL,
  };
}

interface Opened {
  branch: string;
  title: string;
  body: string;
}

interface Pulls {
  open: PullRef[];
  refusal?: Error;
}

function scene({ open = [], refusal }: Partial<Pulls> = {}) {
  const opened: Opened[] = [];
  const recorded: string[] = [];
  const deps: OpenOnboardPrDeps = {
    pulls: () =>
      Promise.resolve({
        list: () => Promise.resolve(open),
        open: (branch, { title, body }) => {
          opened.push({ branch, title, body });

          return refusal ? Promise.reject(refusal) : Promise.resolve(pullRef());
        },
      }),
    recordOnboardingPr: (repo, url) => {
      recorded.push(`${repo} ${url}`);

      return Promise.resolve();
    },
  };

  return { handle: openOnboardPrHandle(deps), opened, recorded };
}

describe("the onboard-open-pr station", () => {
  it("opens the onboarding pull request from the run's branch with the Lore-Task footer", async () => {
    const { handle, opened } = scene();

    await handle(brief(), TOOLS);

    expect(opened).toEqual([
      {
        branch: "lore/onboard/app-1234abcd",
        title: "lore: onboard re-cinq/app",
        body: "Onboards this repository to Lore: the workflows and templates Lore keeps current, and the repository-specific files written from the onboarding ticket.\n\nLore-Task: task-1",
      },
    ]);
  });

  it("puts the needs-attention section in the pull request body, above the footer", async () => {
    const { handle, opened } = scene();

    await handle(brief("## Needs attention\n\n- no secret"), TOOLS);

    expect(opened[0].body).toContain(
      "onboarding ticket.\n\n## Needs attention\n\n- no secret\n\nLore-Task: task-1",
    );
  });

  it("produces pr_url and records it as the repository's onboarding pull request", async () => {
    const { handle, recorded } = scene();

    expect(await handle(brief(), TOOLS)).toEqual({
      outcome: "success",
      produced: { pr_url: PR_URL },
    });
    expect(recorded).toEqual([`re-cinq/app ${PR_URL}`]);
  });

  it("reuses the pull request already open on the branch instead of opening a second", async () => {
    const { handle, opened } = scene({ open: [pullRef()] });

    expect(await handle(brief(), TOOLS)).toEqual({
      outcome: "success",
      produced: { pr_url: PR_URL },
    });
    expect(opened).toEqual([]);
  });

  it("reports changes_requested and records nothing when the branch has no commits to open a pull request from", async () => {
    const { handle, recorded } = scene({
      refusal: new Error(
        "Validation Failed: No commits between main and lore/x",
      ),
    });

    expect(await handle(brief(), TOOLS)).toEqual({
      outcome: "changes_requested",
    });
    expect(recorded).toEqual([]);
  });

  it("reports failed with the error when GitHub refuses for any other reason", async () => {
    const { handle } = scene({ refusal: new Error("Bad credentials") });

    expect(await handle(brief(), TOOLS)).toEqual({
      outcome: "failed",
      error: "Bad credentials",
    });
  });
});
