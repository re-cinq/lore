import { describe, expect, it } from "vitest";
import type { Tools } from "@re-cinq/floor-station";
import type { PullRef } from "@re-cinq/lore-shared/project/pulls/pull-requests-port.js";
import {
  openSpecPrHandle,
  type OpenSpecPrDeps,
  type OpenSpecPrProject,
} from "./station.js";

const TOOLS: Tools = {
  read: () => Promise.resolve(Buffer.from("")),
  produce: () => Promise.resolve(),
  modelCall: () => Promise.resolve(),
  signal: new AbortController().signal,
};

function brief(target = "github.com/re-cinq/lore@spec/widget") {
  return { visitId: "visit-pr", iteration: 1, needs: { target } };
}

function openedTitleFor(planTitle: string): Promise<string> {
  const titles: string[] = [];
  const handle = scene({
    pulls: {
      list: () => Promise.resolve([]),
      open: (_branch, pr) => {
        titles.push(pr.title);

        return Promise.resolve(pullRef());
      },
    },
  });

  return handle(briefTitled(planTitle), TOOLS).then(() => titles[0]);
}

function briefTitled(planTitle: string) {
  return {
    visitId: "visit-pr",
    iteration: 1,
    needs: {
      target: "github.com/re-cinq/lore@spec/widget",
      plan_title: planTitle,
    },
  };
}

function pullRef(overrides: Partial<PullRef> = {}): PullRef {
  return {
    repo: "re-cinq/lore",
    number: 42,
    title: "spec: spec/widget",
    branch: "spec/widget",
    state: "open",
    labels: [],
    url: "https://github.com/re-cinq/lore/pull/42",
    ...overrides,
  };
}

function scene(project: OpenSpecPrProject) {
  const deps: OpenSpecPrDeps = { project: () => Promise.resolve(project) };

  return openSpecPrHandle(deps);
}

describe("openSpecPrHandle", () => {
  it("produces the existing open PR's url on spec/widget rather than opening a second one", async () => {
    const existing = pullRef();
    const opened: unknown[] = [];
    const handle = scene({
      pulls: {
        list: () => Promise.resolve([existing]),
        open: (branch, pr) => {
          opened.push({ branch, pr });

          return Promise.reject(new Error("should not open a second PR"));
        },
      },
    });

    expect(await handle(brief(), TOOLS)).toEqual({
      outcome: "success",
      produced: { pr_url: "https://github.com/re-cinq/lore/pull/42" },
    });
    expect(opened).toEqual([]);
  });

  it("opens spec: spec/widget on spec/widget when no PR is open on that branch yet", async () => {
    const opened: { branch: string; pr: { title: string; body: string } }[] =
      [];
    const handle = scene({
      pulls: {
        list: () => Promise.resolve([]),
        open: (branch, pr) => {
          opened.push({ branch, pr });

          return Promise.resolve(
            pullRef({
              number: 43,
              url: "https://github.com/re-cinq/lore/pull/43",
            }),
          );
        },
      },
    });

    const result = await handle(brief(), TOOLS);

    expect(result).toEqual({
      outcome: "success",
      produced: { pr_url: "https://github.com/re-cinq/lore/pull/43" },
    });
    expect(opened).toEqual([
      {
        branch: "spec/widget",
        pr: {
          title: "spec: spec/widget",
          body: "Opened by the Lore feature-planning line from `spec/widget`.",
        },
      },
    ]);
  });

  it("titles the PR spec: Notify people when a run fails after the plan it came from", async () => {
    expect(await openedTitleFor("Notify people when a run fails")).toBe(
      "spec: Notify people when a run fails",
    );
  });

  it("cuts a plan title past 70 characters with an ellipsis, so it does not fill a reader's list", async () => {
    const title = await openedTitleFor(`${"long plan title ".repeat(8)}end`);

    expect({ length: title.length, tail: title.slice(-1) }).toEqual({
      length: 70,
      tail: "\u2026",
    });
  });

  it("reports failed with the error message when opening the PR fails", async () => {
    const handle = scene({
      pulls: {
        list: () => Promise.resolve([]),
        open: () => Promise.reject(new Error("GitHub is down")),
      },
    });

    expect(await handle(brief(), TOOLS)).toEqual({
      outcome: "failed",
      error: "GitHub is down",
    });
  });
});
