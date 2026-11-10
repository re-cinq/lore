import {
  planRun,
  planVisit,
} from "@re-cinq/lore-shared/floor/recorded-plan-floor.js";
import type { CheckRunInput } from "@re-cinq/lore-shared/project/lib/github-port.js";
import { beforeEach, describe, expect, it } from "vitest";
import {
  clearLoopProgressArgs,
  loopProgressHandlers,
  publishLoopRunProgress,
  refreshLoopRunById,
  type LoopProgressDeps,
  type LoopRunView,
  type LoopVisitView,
} from "./loop-progress-handlers.js";

const PR_URL = "https://github.com/re-cinq/lore/pull/241";

describe("Loop progress PR check acceptance (FR17)", () => {
  beforeEach(() => {
    clearLoopProgressArgs();
  });

  it("refreshes lore/implementation-loop as the walk enters each step and once more when the finisher closes the run", async () => {
    const { checks, stepVisit, settle } = walkScene();

    await stepVisit();
    await stepVisit();
    await settle();

    expect(checks.map((check) => check.status)).toEqual([
      "in_progress",
      "in_progress",
      "completed",
    ]);
    expect(checks[0]?.summary).toContain("Now at `tdd-round` (visit 1)");
    expect(checks[2]).toMatchObject({
      headSha: "sha-live-1",
      name: "lore/implementation-loop",
      conclusion: "success",
      summary: "Finished.",
    });
  });

  it("publishes a green completed check when the run finished even though its rounds recorded changes_requested on the way", async () => {
    const { checks, settle } = completedAfterRoundsScene();

    await settle();

    expect(checks).toHaveLength(1);
    expect(checks[0]).toMatchObject({
      headSha: "sha-final",
      name: "lore/implementation-loop",
      status: "completed",
      conclusion: "success",
      summary: "Finished.",
    });
  });

  it("closes the check on the previous head as neutral Superseded before publishing on the new head and records pr_check_sha in args", async () => {
    const { checks, mergedArgs, run, visits, deps, setHead } =
      headMovementScene();
    const synchronize = loopProgressHandlers(deps).get(
      "github.pull_request.synchronize",
    );

    await publishLoopRunProgress(deps, run, visits);
    setHead("sha-new");
    await synchronize?.({ repo: "re-cinq/lore", pr_number: 241 });

    expect(checks).toMatchObject([
      { headSha: "sha-old", status: "in_progress" },
      {
        headSha: "sha-old",
        status: "completed",
        conclusion: "neutral",
        title: "Superseded",
      },
      { headSha: "sha-new", status: "in_progress" },
    ]);
    expect(mergedArgs).toEqual([
      { pr_check_sha: "sha-old" },
      { pr_check_sha: "sha-new" },
    ]);
    expect(run.args?.pr_check_sha).toBe("sha-new");
  });
});

function walkScene() {
  const checks: CheckRunInput[] = [];
  const snapshots: Array<{ run: LoopRunView; visits: LoopVisitView[] }> = [
    {
      run: activeLoopRun(),
      visits: [openPrVisit(), planVisit("tdd-round", null)],
    },
    {
      run: activeLoopRun(),
      visits: [
        openPrVisit(),
        planVisit("tdd-round", { outcome: "changes_requested" }),
        planVisit("await-ci", null),
      ],
    },
    {
      run: activeLoopRun({
        outcome: "success",
        finishedAt: "2026-11-10T20:00:00.000Z",
      }),
      visits: [
        openPrVisit(),
        planVisit("tdd-round", { outcome: "changes_requested" }),
        planVisit("await-pr", { outcome: "success" }),
      ],
    },
  ];
  let index = 0;
  const deps: LoopProgressDeps = {
    run: () => Promise.resolve(snapshots[index]?.run ?? null),
    visits: () => {
      const visits = snapshots[index]?.visits ?? [];

      index += 1;

      return Promise.resolve(visits);
    },
    pullHeadSha: () => Promise.resolve("sha-live-1"),
    upsertCheckRun: (_repo, input) => {
      checks.push(input);

      return Promise.resolve();
    },
  };

  return {
    checks,
    stepVisit: () => refreshLoopRunById(deps, "run-241"),
    settle: () => refreshLoopRunById(deps, "run-241"),
  };
}

function completedAfterRoundsScene() {
  const checks: CheckRunInput[] = [];
  const run = activeLoopRun({
    outcome: "success",
    finishedAt: "2026-11-10T20:05:00.000Z",
  });
  const visits: LoopVisitView[] = [
    openPrVisit(),
    planVisit("tdd-round", { outcome: "changes_requested" }),
    planVisit("await-ci", { outcome: "changes_requested" }),
    planVisit("tdd-round", { outcome: "success" }, { iteration: 2 }),
    planVisit("await-pr", { outcome: "success" }),
  ];
  const deps: LoopProgressDeps = {
    run: () => Promise.resolve(run),
    visits: () => Promise.resolve(visits),
    pullHeadSha: () => Promise.resolve("sha-final"),
    upsertCheckRun: (_repo, input) => {
      checks.push(input);

      return Promise.resolve();
    },
  };

  return {
    checks,
    settle: () => refreshLoopRunById(deps, run.id),
  };
}

function headMovementScene() {
  const checks: CheckRunInput[] = [];
  const mergedArgs: Array<{ pr_check_sha: string }> = [];
  let currentHead = "sha-old";
  const run = activeLoopRun({ args: { pr_number: 241 } });
  const visits: LoopVisitView[] = [
    openPrVisit(),
    planVisit("await-ci", null, { iteration: 2 }),
  ];
  const deps: LoopProgressDeps = {
    run: () => Promise.resolve(run),
    visits: () => Promise.resolve(visits),
    openLoopRuns: () => Promise.resolve([run]),
    pullHeadSha: () => Promise.resolve(currentHead),
    upsertCheckRun: (_repo, input) => {
      checks.push(input);

      return Promise.resolve();
    },
    mergeArgs: (_runId, patch) => {
      mergedArgs.push(patch);

      return Promise.resolve();
    },
  };

  return {
    checks,
    mergedArgs,
    run,
    visits,
    deps,
    setHead: (next: string) => {
      currentHead = next;
    },
  };
}

function activeLoopRun(overrides: Partial<LoopRunView> = {}): LoopRunView {
  return {
    ...planRun({
      id: "run-241",
      lineId: "implementation-loop",
      repo: "github.com/re-cinq/lore",
      outcome: null,
      finishedAt: null,
    }),
    args: {},
    ...overrides,
  };
}

function openPrVisit(): LoopVisitView {
  return planVisit("open-pr", {
    outcome: "success",
    produced: { pr_url: PR_URL },
  });
}
