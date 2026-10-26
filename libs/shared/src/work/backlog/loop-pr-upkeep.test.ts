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
  lastParkedAt,
  upkeepExhausted,
  upkeepExhaustedComment,
  UPKEEP_RUNS_PER_PULL,
  type UpkeepFacts,
} from "./loop-pr-upkeep.js";

const ON_MAIN: UpkeepFacts = {
  mergeState: "clean",
  mergeable: true,
  ci: "success",
  review: "none",
};

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

  it("starts an upkeep run for a settled pull request GitHub calls behind, one in conflict, and one whose build is red", () => {
    expect(
      [
        { ...ON_MAIN, mergeState: "behind" },
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

describe("decideUpkeep on a pull request behind main that no rule needs up to date", () => {
  it("does nothing for a green pull request GitHub calls clean, however far main has moved, since every push to main would otherwise rebase it (lore #2879, 24 upkeep runs in two days)", () => {
    expect(
      decideUpkeep({
        openRun: false,
        facts: { ...ON_MAIN, mergeState: "clean" },
      }),
    ).toEqual("none");
  });
});

describe("decideUpkeep on a pull request Lore's review asked changes on", () => {
  it("starts an upkeep run for a green pull request GitHub calls clean when Lore's review on its head asked for changes, since only the loop fixes them", () => {
    expect(
      decideUpkeep({
        openRun: false,
        facts: { ...ON_MAIN, review: "changes_requested" },
      }),
    ).toEqual("start");
  });
});

const upkeepRun = (
  prNumber: number,
  createdAt: string,
  outcome: string | null,
) =>
  planRun({
    id: `run-${prNumber}-${createdAt}`,
    lineId: "implementation-loop",
    subjectKey: `backlog:upkeep-${prNumber}`,
    createdAt,
    finishedAt: outcome === null ? null : createdAt,
    outcome,
  });

describe("upkeepExhausted", () => {
  it("is gave_up after pull request 12's two newest upkeep runs both ended iteration_max, whatever an older one did", () => {
    const runs = [
      upkeepRun(12, "2026-10-25T10:00:00Z", "success"),
      upkeepRun(12, "2026-10-25T13:00:00Z", "iteration_max"),
      upkeepRun(12, "2026-10-25T12:00:00Z", "iteration_max"),
    ];

    expect(upkeepExhausted(12, runs)).toEqual({ kind: "gave_up", runs: 3 });
  });

  it("is null after one run that gave up, after a give-up followed by a success, and for a pull request with no upkeep run", () => {
    expect([
      upkeepExhausted(12, [
        upkeepRun(12, "2026-10-25T12:00:00Z", "iteration_max"),
      ]),
      upkeepExhausted(12, [
        upkeepRun(12, "2026-10-25T12:00:00Z", "iteration_max"),
        upkeepRun(12, "2026-10-25T13:00:00Z", "success"),
      ]),
      upkeepExhausted(12, []),
    ]).toEqual([null, null, null]);
  });

  it("is lifetime at pull request 12's 10th upkeep run, however each ended, and counts no other pull request's runs nor the backlog run", () => {
    const own = Array.from({ length: UPKEEP_RUNS_PER_PULL }, (_, i) =>
      upkeepRun(12, `2026-10-2${i % 2}T0${i % 10}:00:00Z`, "success"),
    );
    const others = [
      ...Array.from({ length: UPKEEP_RUNS_PER_PULL }, (_, i) =>
        upkeepRun(13, `2026-10-25T0${i % 10}:00:00Z`, "iteration_max"),
      ),
      planRun({ subjectKey: "backlog:tickets", outcome: "iteration_max" }),
    ];

    expect([
      upkeepExhausted(12, [...own, ...others]),
      upkeepExhausted(12, [...own.slice(1), ...others]),
    ]).toEqual([{ kind: "lifetime", runs: UPKEEP_RUNS_PER_PULL }, null]);
  });
});

describe("upkeepExhausted since the ticket's last park", () => {
  it("counts no run that started before the park, so a ticket a person unparked gets its upkeep again instead of being parked at once on the same two give-ups", () => {
    const runs = [
      upkeepRun(12, "2026-10-25T12:00:00Z", "iteration_max"),
      upkeepRun(12, "2026-10-25T13:00:00Z", "iteration_max"),
    ];

    expect([
      upkeepExhausted(12, runs, "2026-10-25T13:30:00Z"),
      upkeepExhausted(12, runs, "2026-10-25T12:30:00Z"),
      upkeepExhausted(12, runs, null),
    ]).toEqual([null, null, { kind: "gave_up", runs: 2 }]);
  });
});

describe("lastParkedAt", () => {
  it("is the newest of Lore's parking comments, whichever park wrote it, and null when none did", () => {
    const comments = [
      {
        id: 1,
        user: "lore-agent[bot]",
        created_at: "2026-10-24T23:40:33Z",
        body: "Lore's implementation loop is parking this ticket: the run ended iteration_max.",
      },
      {
        id: 2,
        user: "gedaiu",
        created_at: "2026-10-25T08:00:00Z",
        body: "Lore's implementation loop is parking this ticket: no it is not, I am quoting it.",
      },
      {
        id: 3,
        user: "lore-agent[bot]",
        created_at: "2026-10-25T09:54:48Z",
        body: "Lore's implementation loop is parking this ticket: its last two upkeep runs gave up.",
      },
      {
        id: 4,
        user: "lore-agent[bot]",
        created_at: "2026-10-25T14:22:57Z",
        body: "Lore's implementation loop sees this ticket's pull request merged.",
      },
    ];

    expect([lastParkedAt(comments), lastParkedAt([])]).toEqual([
      "2026-10-25T09:54:48Z",
      null,
    ]);
  });
});

describe("upkeepExhaustedComment", () => {
  it("says the two give-ups, names the pull request and how to re-queue", () => {
    expect(upkeepExhaustedComment(PULL, { kind: "gave_up", runs: 3 })).toEqual(
      "Lore's implementation loop is parking this ticket: its last two upkeep runs on https://github.com/acme/widgets/pull/12 gave up (`iteration_max`), so starting another would end the same way.\n\nThe pull request stays open for a human. Remove the `lore:blocked` label to let the loop keep it up to date again.",
    );
  });

  it("says the lifetime cap was reached", () => {
    expect(
      upkeepExhaustedComment(PULL, { kind: "lifetime", runs: 10 }),
    ).toEqual(
      "Lore's implementation loop is parking this ticket: https://github.com/acme/widgets/pull/12 has had 10 upkeep runs, the most the loop gives one pull request, so it is a person's to merge or close.\n\nThe pull request stays open for a human. Remove the `lore:blocked` label to let the loop keep it up to date again.",
    );
  });
});
