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
  const deps: OpenOnboardPrDeps = {
    pulls: () =>
      Promise.resolve({
        list: () => Promise.resolve(open),
        open: (branch, { title, body }) => {
          opened.push({ branch, title, body });

          return refusal ? Promise.reject(refusal) : Promise.resolve(pullRef());
        },
      }),
    recordOnboardingPr: () => Promise.resolve(),
  };

  return { handle: openOnboardPrHandle(deps), opened };
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

describe("the onboard-open-pr station", () => {
  it("includes the sections required by the PR description check in the generated pull request body", async () => {
    const { handle, opened } = scene();

    await handle(brief(), TOOLS);

    const body = opened[0].body;
    const requiredSections = [
      "## Why",
      "## What Changed",
      "## Testing",
      "## Alternatives Considered",
      "## ADRs & Architecture",
    ];

    expect(
      requiredSections.every((section) =>
        new RegExp(`^${section}`, "m").test(body),
      ),
    ).toBe(true);
    expect(body).not.toMatch(/CI/);
  });
});
