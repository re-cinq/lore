import { describe, expect, it } from "vitest";
import {
  PLAN_BLOB_HASH,
  planRun,
  recordedPlanFloor,
} from "../../outbound/floor/recorded-plan-floor.js";
import {
  decideUpkeep,
  isLoopPull,
  openRunOnBranch,
  startUpkeepRun,
  type UpkeepFacts,
} from "./loop-pr-upkeep.js";

const ON_MAIN: UpkeepFacts = { behindBy: 0, mergeable: true, ci: "success" };

const PULL = {
  number: 12,
  url: "https://github.com/acme/widgets/pull/12",
  branch: "lore/implementation-loop/issue-7",
  state: "open" as const,
};

describe("decideUpkeep", () => {
  it("judges the parked wait now when a loop run is open on the branch, whatever the pull request looks like", () => {
    expect(decideUpkeep({ openRun: true, facts: ON_MAIN })).toEqual(
      "judge_parked",
    );
  });

  it("starts an upkeep run for a settled pull request 2 commits behind main, one in conflict, and one whose build is red", () => {
    expect(
      [
        { ...ON_MAIN, behindBy: 2 },
        { ...ON_MAIN, mergeable: false },
        { ...ON_MAIN, ci: "failure" as const },
      ].map((facts) => decideUpkeep({ openRun: false, facts })),
    ).toEqual(["start", "start", "start"]);
  });

  it("does nothing for a settled pull request on current main with a green or pending build", () => {
    expect(
      [ON_MAIN, { ...ON_MAIN, ci: "pending" as const, mergeable: null }].map(
        (facts) => decideUpkeep({ openRun: false, facts }),
      ),
    ).toEqual(["none", "none"]);
  });
});

describe("isLoopPull", () => {
  it("takes an open pull request on lore/implementation-loop/issue-7 and leaves a person's branch and a closed one", () => {
    expect([
      isLoopPull(PULL),
      isLoopPull({ ...PULL, branch: "feature/export" }),
      isLoopPull({ ...PULL, state: "closed" }),
    ]).toEqual([true, false, false]);
  });
});

describe("openRunOnBranch", () => {
  it("finds the run whose repo start item is on the branch, by the branch alone", () => {
    const runs = [
      planRun({
        id: "run-other",
        startItems: {
          repo: {
            kind: "git",
            ref: "github.com/acme/widgets@lore/implementation-loop/issue-9",
            by: "lore",
          },
        },
      }),
      planRun({
        id: "run-7",
        startItems: {
          repo: {
            kind: "git",
            ref: "github.com/acme/widgets@lore/implementation-loop/issue-7",
            by: "lore",
          },
        },
      }),
    ];

    expect([
      openRunOnBranch(runs, "lore/implementation-loop/issue-7")?.id,
      openRunOnBranch(runs, "lore/implementation-loop/issue-8")?.id,
    ]).toEqual(["run-7", undefined]);
  });
});

describe("startUpkeepRun", () => {
  it("starts implementation-loop at sync-pr for pull request 12, keyed on upkeep-12, with the ticket, task and pull request url", async () => {
    const recorded = recordedPlanFloor();

    await startUpkeepRun(recorded.floor, {
      repo: "acme/widgets",
      pull: PULL,
      issue: { number: 7, title: "Add the export button", body: "Export." },
      taskId: "task-1",
    });

    expect(
      recorded.requests
        .filter(({ path }) => path.endsWith("/start"))
        .map(({ path, body }) => ({ path, body })),
    ).toEqual([
      {
        path: "/assembly-lines/implementation-loop/start",
        body: {
          repo: "github.com/acme/widgets",
          entry: "sync-pr",
          startItems: {
            repo: {
              kind: "git",
              ref: "github.com/acme/widgets@lore/implementation-loop/issue-7",
              by: "lore",
            },
            backlog: { kind: "value", ref: "upkeep-12", by: "lore" },
            task_id: { kind: "value", ref: "task-1", by: "lore" },
            ticket: { kind: "file", ref: PLAN_BLOB_HASH, by: "lore" },
            issue_title: {
              kind: "value",
              ref: "Add the export button",
              by: "lore",
            },
            issue_number: { kind: "value", ref: "7", by: "lore" },
            pr_url: {
              kind: "value",
              ref: "https://github.com/acme/widgets/pull/12",
              by: "lore",
            },
          },
        },
      },
    ]);
  });
});
