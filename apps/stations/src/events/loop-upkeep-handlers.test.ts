import { describe, expect, it } from "vitest";
import {
  planRun,
  recordedPlanFloor,
} from "@re-cinq/lore-shared/floor/recorded-plan-floor.js";
import type { PullRef } from "@re-cinq/lore-shared/project/pulls/pull-requests-port.js";
import {
  LOOP_UPKEEP_EVENTS,
  loopUpkeepHandlers,
  type UpkeepProject,
} from "./loop-upkeep-handlers.js";

const REPO = "acme/widgets";

const pull = (over: Partial<PullRef> = {}): PullRef => ({
  repo: REPO,
  number: 12,
  title: "Add the export button",
  branch: "lore/implementation-loop/issue-7",
  state: "open",
  labels: [],
  url: "https://github.com/acme/widgets/pull/12",
  baseBranch: "main",
  headSha: "abc",
  mergeable: true,
  ...over,
});

const LOOP_RUN_ON_7 = planRun({
  id: "run-7",
  lineId: "implementation-loop",
  repo: "github.com/acme/widgets",
  startItems: {
    repo: {
      kind: "git",
      ref: "github.com/acme/widgets@lore/implementation-loop/issue-7",
      by: "lore",
    },
  },
});

interface SceneInput {
  pulls?: PullRef[];
  mergeState?: string;
  ci?: "success" | "failure" | "pending" | "none";
  openRuns?: ReturnType<typeof planRun>[];
  loopOn?: boolean;
  ticketLabels?: string[];
  loreReview?: "failure" | "neutral" | "success";
  pastRuns?: ReturnType<typeof planRun>[];
  ticketComments?: Array<{ created_at: string; body: string }>;
}

function scene(input: SceneInput = {}) {
  const pulls = input.pulls ?? [pull()];
  const recorded = recordedPlanFloor({
    runs: [...(input.openRuns ?? []), ...(input.pastRuns ?? [])],
  });
  const judged: number[] = [];
  const parked: Array<[string, number, string]> = [];
  const project: UpkeepProject = {
    pulls: {
      list: async () => pulls,
      get: async (number) => pulls.find((p) => p.number === number) ?? null,
      getMergeability: async () => ({
        mergeable: true,
        state: input.mergeState ?? "clean",
      }),
      listCommits: async () => [
        { sha: "abc", message: "feat", parents: [] } as never,
        {
          sha: "def",
          message: "style: prettier [skip ci]",
          parents: [],
        } as never,
      ],
      listChecks: async (ref) =>
        ref === "abc"
          ? [
              {
                id: 1,
                name: "build",
                status: "completed",
                conclusion: input.ci ?? "success",
              },
              {
                id: 2,
                name: "lore/code-review",
                status: "completed",
                conclusion: input.loreReview ?? "failure",
              },
            ]
          : [],
    },
    repo: {
      defaultBranch: async () => "main",
    },
    issues: {
      get: async (number) => ({
        repo: REPO,
        number,
        title: "Add the export button",
        state: "open",
        labels: input.ticketLabels ?? [],
        body: "Export.",
      }),
      listComments: async () =>
        (input.ticketComments ?? []).map((comment, id) => ({
          id,
          user: "lore-agent[bot]",
          ...comment,
        })),
      addLabel: async (number, label) => {
        parked.push(["label", number, label]);
      },
      comment: async (number, body) => {
        parked.push(["comment", number, body]);
      },
    },
    settings: {
      rawSettings: async () => ({
        implementation_loop: { enabled: input.loopOn ?? true },
      }),
    },
  };
  const handlers = loopUpkeepHandlers({
    floor: () => recorded.floor,
    project: async () => project,
    latestLoopTaskByIssue: async () => ({ id: "task-1" }),
    judgeParked: async (_repo, prNumber) => {
      judged.push(prNumber);

      return "judged";
    },
  });
  const starts = () =>
    recorded.requests
      .filter(({ path }) => path.endsWith("/start"))
      .map(
        ({ body }) =>
          body as {
            entry?: string;
            startItems: Record<string, { ref: string }>;
          },
      )
      .map((body) => [
        body.entry,
        body.startItems.backlog?.ref,
        body.startItems.pr_url?.ref,
      ]);
  const push = (branch: string) =>
    handlers.get("github.push")!({ repo: REPO, branch });
  const suite = (numbers: number[]) =>
    handlers.get("github.check_suite.completed")!({
      repo: REPO,
      head_sha: "abc",
      pr_numbers: numbers,
    });

  return { push, suite, starts, judged, parked, handlers };
}

const gaveUp = (prNumber: number, createdAt: string) =>
  planRun({
    id: `run-${prNumber}-${createdAt}`,
    lineId: "implementation-loop",
    repo: "github.com/acme/widgets",
    subjectKey: `backlog:upkeep-${prNumber}`,
    createdAt,
    finishedAt: createdAt,
    outcome: "iteration_max",
  });

describe("loopUpkeepHandlers", () => {
  it("answers github.push and github.check_suite.completed, the two events it asks the bus for", () => {
    expect([...scene().handlers.keys()]).toEqual([...LOOP_UPKEEP_EVENTS]);
  });

  it("starts the line at sync-pr, keyed on upkeep-12, when main moves and GitHub calls settled pull request 12 behind it", async () => {
    const { push, starts, judged } = scene({ mergeState: "behind" });

    await push("main");

    expect({ starts: starts(), judged }).toEqual({
      starts: [
        ["sync-pr", "upkeep-12", "https://github.com/acme/widgets/pull/12"],
      ],
      judged: [],
    });
  });

  it("judges the parked wait of the open run on issue 7's branch instead of starting a second run", async () => {
    const { push, starts, judged } = scene({
      mergeState: "behind",
      openRuns: [LOOP_RUN_ON_7],
    });

    await push("main");

    expect({ starts: starts(), judged }).toEqual({ starts: [], judged: [12] });
  });

  it("starts nothing for pull request 12 whose only red check is Lore's own lore/code-review", async () => {
    const { suite, starts } = scene({ ci: "success" });

    await suite([12]);

    expect(starts()).toEqual([]);
  });

  it("finds settled pull request 12 by its head abc when the suite names no pull request", async () => {
    const { suite, starts } = scene({ ci: "failure" });

    await suite([]);

    expect(starts()).toEqual([
      ["sync-pr", "upkeep-12", "https://github.com/acme/widgets/pull/12"],
    ]);
  });

  it("starts an upkeep run when the build is red on the judged commit abc, under a skip-ci commit, of settled pull request 12, and none for a person's pull request 13", async () => {
    const { suite, starts } = scene({
      ci: "failure",
      pulls: [pull(), pull({ number: 13, branch: "feature/export" })],
    });

    await suite([12, 13]);

    expect(starts()).toEqual([
      ["sync-pr", "upkeep-12", "https://github.com/acme/widgets/pull/12"],
    ]);
  });

  it("starts upkeep runs for the 3 oldest of 5 loop pull requests behind main on one push, and leaves 14 and 15 for the next event", async () => {
    const behind = [15, 11, 14, 12, 13].map((number) =>
      pull({
        number,
        branch: `lore/implementation-loop/issue-${number}`,
        url: `https://github.com/acme/widgets/pull/${number}`,
      }),
    );
    const { push, starts } = scene({ pulls: behind, mergeState: "behind" });

    await push("main");

    expect(starts().map(([, backlog]) => backlog)).toEqual([
      "upkeep-11",
      "upkeep-12",
      "upkeep-13",
    ]);
  });

  it("starts nothing for a push to a feature branch, for a pull request on current main with a green build, or where the implementation loop is off", async () => {
    const featurePush = scene({ mergeState: "behind" });
    const healthy = scene();
    const loopOff = scene({ mergeState: "behind", loopOn: false });

    await featurePush.push("feature/export");
    await healthy.push("main");
    await loopOff.push("main");

    expect([featurePush.starts(), healthy.starts(), loopOff.starts()]).toEqual([
      [],
      [],
      [],
    ]);
  });
});

describe("loopUpkeepHandlers rotating its starts", () => {
  it("starts 14, 15 and then 12, upkept earliest, when 11, 12 and 13 were each upkept at the last push", async () => {
    const behind = [11, 12, 13, 14, 15].map((number) =>
      pull({
        number,
        branch: `lore/implementation-loop/issue-${number}`,
        url: `https://github.com/acme/widgets/pull/${number}`,
      }),
    );
    const upkept = (number: number, createdAt: string) =>
      planRun({
        id: `upkeep-run-${number}`,
        lineId: "implementation-loop",
        repo: "github.com/acme/widgets",
        subjectKey: `backlog:upkeep-${number}`,
        startItems: {
          repo: {
            kind: "git",
            ref: `github.com/acme/widgets@lore/implementation-loop/issue-${number}`,
            by: "lore",
          },
        },
        outcome: "iteration_max",
        createdAt,
        finishedAt: "2026-10-25T07:40:00.000Z",
      });
    const { push, starts } = scene({
      pulls: behind,
      mergeState: "behind",
      openRuns: [
        upkept(11, "2026-10-25T07:27:03.000Z"),
        upkept(12, "2026-10-25T07:27:01.000Z"),
        upkept(13, "2026-10-25T07:27:02.000Z"),
      ],
    });

    await push("main");

    expect(starts().map(([, backlog]) => backlog)).toEqual([
      "upkeep-14",
      "upkeep-15",
      "upkeep-12",
    ]);
  });
});

describe("loop upkeep on a parked ticket", () => {
  it("starts nothing for settled pull request 12 whose ticket the loop parked with lore:blocked, since a parked ticket is a person's until they unpark it (lore #2879 kept getting upkeep runs after each parking)", async () => {
    const parked = scene({
      mergeState: "behind",
      ticketLabels: ["lore:blocked"],
    });

    await parked.push("main");

    expect(parked.starts()).toEqual([]);
  });
});

describe("loop upkeep on a pull request Lore's review asked changes on", () => {
  it("starts an upkeep run at sync-pr for settled pull request 12, on main and green, whose head Lore's review asked changes on (otto #478 sat with nobody to fix them)", async () => {
    const { suite, starts } = scene({ loreReview: "neutral" });

    await suite([12]);

    expect(starts()).toEqual([
      ["sync-pr", "upkeep-12", "https://github.com/acme/widgets/pull/12"],
    ]);
  });
});

describe("loop upkeep on a pull request whose upkeep keeps giving up", () => {
  it("parks issue 7 with lore:blocked and a comment, and starts nothing, when settled pull request 12 behind main had its last two upkeep runs end iteration_max (lore #2879 got 25 runs, #2880 27, over the weekend of 2026-10-23)", async () => {
    const { push, starts, parked } = scene({
      mergeState: "behind",
      pastRuns: [
        gaveUp(12, "2026-10-25T12:00:00Z"),
        gaveUp(12, "2026-10-25T13:00:00Z"),
      ],
    });

    await push("main");

    expect({
      starts: starts(),
      parked: parked.map(([what, issue, text]) => [
        what,
        issue,
        text.slice(0, 59),
      ]),
    }).toEqual({
      starts: [],
      parked: [
        ["label", 7, "lore:blocked"],
        [
          "comment",
          7,
          "Lore's implementation loop is parking this ticket: its last",
        ],
      ],
    });
  });

  it("starts the upkeep run when only the newest of pull request 12's runs gave up, and when both give-ups are older than Lore's last parking comment, since a person took the label off to get one (the review of #3525)", async () => {
    const unparked = {
      created_at: "2026-10-25T13:00:30Z",
      body: "Lore's implementation loop is parking this ticket: its last two upkeep runs gave up.",
    };
    const outcomes = [];

    for (const input of [
      { pastRuns: [gaveUp(12, "2026-10-25T13:00:00Z")] },
      {
        pastRuns: [
          gaveUp(12, "2026-10-25T12:00:00Z"),
          gaveUp(12, "2026-10-25T13:00:00Z"),
        ],
        ticketComments: [unparked],
      },
    ]) {
      const { push, starts, parked } = scene({
        mergeState: "behind",
        ...input,
      });

      await push("main");
      outcomes.push({ starts: starts(), parked });
    }

    expect(outcomes).toEqual(
      Array(2).fill({
        starts: [
          ["sync-pr", "upkeep-12", "https://github.com/acme/widgets/pull/12"],
        ],
        parked: [],
      }),
    );
  });
});
