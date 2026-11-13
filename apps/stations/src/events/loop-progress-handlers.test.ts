import {
  planRun,
  planVisit,
} from "@re-cinq/lore-shared/floor/recorded-plan-floor.js";
import type { CheckRunInput } from "@re-cinq/lore-shared/project/lib/github-port.js";
import { beforeEach, describe, expect, it } from "vitest";
import {
  clearLoopProgressArgs,
  LOOP_STEP_DESCRIPTIONS,
  loopProgressCheck,
  loopProgressHandlers,
  publishLoopRunProgress,
  supersededLoopCheck,
  type LoopProgressDeps,
  type LoopRunView,
  type LoopVisitView,
} from "./loop-progress-handlers.js";

const PR_URL = "https://github.com/re-cinq/lore/pull/241";
const LIVE_SHA = "9dcdcc5";

describe("loopProgressCheck and publishLoopRunProgress", () => {
  beforeEach(() => {
    clearLoopProgressArgs();
  });

  it("publishes lore/implementation-loop on the pull request's live head rather than a stale head_sha stamped at start", () => {
    const run = loopRun({
      startItems: {
        pr_url: { kind: "value", ref: PR_URL, by: "lore" },
        head_sha: { kind: "value", ref: "stale-start-sha", by: "lore" },
      },
    });
    const check = loopProgressCheck(run, [], { liveHeadSha: LIVE_SHA });

    expect(check).toMatchObject({
      headSha: LIVE_SHA,
      name: "lore/implementation-loop",
      status: "in_progress",
    });
  });

  it("publishes nothing while the pull request's live head is unknown or no PR exists yet", async () => {
    const { checks, deps, run, visits } = publishScene({ liveHeadSha: null });

    expect(loopProgressCheck(run, visits, { liveHeadSha: null })).toBeNull();
    await publishLoopRunProgress(deps, run, visits);
    expect(checks).toEqual([]);
  });

  it("opens the run page /assembly-runs/<id> on the Lore UI via detailsUrl", () => {
    const check = loopProgressCheck(loopRun(), [openPrVisit()], {
      liveHeadSha: LIVE_SHA,
      uiUrl: "https://lore.example.com",
    });

    expect(check).toMatchObject({
      detailsUrl: "https://lore.example.com/assembly-runs/694a406f",
    });
  });

  it("titles an in-flight check with the description of the step in flight and names that step and its visit in the summary", () => {
    const visits: LoopVisitView[] = [
      openPrVisit(),
      planVisit(
        "tdd-round",
        { outcome: "changes_requested" },
        { iteration: 3 },
      ),
      planVisit("await-ci", null, { iteration: 3 }),
    ];
    const check = loopProgressCheck(loopRun(), visits, {
      liveHeadSha: LIVE_SHA,
    });

    expect(check).toMatchObject({
      status: "in_progress",
      title: LOOP_STEP_DESCRIPTIONS["await-ci"],
    });
    expect(check?.summary).toContain("Now at `await-ci` (visit 3)");
  });

  it("publishes a green completed check when the run completed even though rounds recorded changes_requested", () => {
    const run = loopRun({
      outcome: "success",
      finishedAt: "2026-11-10T10:00:00.000Z",
    });
    const visits: LoopVisitView[] = [
      openPrVisit(),
      planVisit("tdd-round", { outcome: "changes_requested" }),
      planVisit("await-ci", { outcome: "changes_requested" }),
      planVisit("await-pr", { outcome: "success" }),
    ];

    expect(
      loopProgressCheck(run, visits, { liveHeadSha: LIVE_SHA }),
    ).toMatchObject({
      status: "completed",
      conclusion: "success",
      summary: "Finished.",
    });
  });

  it("publishes failure and cancelled conclusions for non-completed terminal outcomes", () => {
    const failedRun = loopRun({
      outcome: "iteration_max",
      reason: "round budget exhausted",
      finishedAt: "2026-11-10T10:00:00.000Z",
    });
    const cancelledRun = loopRun({
      outcome: "pr_closed",
      finishedAt: "2026-11-10T10:00:00.000Z",
    });

    expect(
      loopProgressCheck(failedRun, [openPrVisit()], { liveHeadSha: LIVE_SHA }),
    ).toMatchObject({
      status: "completed",
      conclusion: "failure",
      summary: "implementation-loop failed — round budget exhausted.",
    });
    expect(
      loopProgressCheck(cancelledRun, [openPrVisit()], {
        liveHeadSha: LIVE_SHA,
      }),
    ).toMatchObject({
      status: "completed",
      conclusion: "cancelled",
      summary: "PR closed.",
    });
  });

  it("refreshes the check on pull request synchronize and sweep tick events", async () => {
    const { checks, deps } = publishScene({ liveHeadSha: LIVE_SHA });
    const handlers = loopProgressHandlers(deps);

    await handlers.get("github.pull_request.synchronize")?.({
      repo: "re-cinq/lore",
      pr_number: 241,
    });
    await handlers.get("cron.pr_ready_check.tick")?.({});

    expect(checks).toHaveLength(2);
    expect(checks[0]).toMatchObject({
      headSha: LIVE_SHA,
      name: "lore/implementation-loop",
      status: "in_progress",
    });
  });

  it("closes the check on the previous head as neutral Superseded when the head moves and returns null when unchanged", () => {
    const nextCheck: CheckRunInput = {
      headSha: "new-sha",
      name: "lore/implementation-loop",
      status: "in_progress",
      title: "Waiting on CI.",
      summary: "Running.",
    };

    expect(
      supersededLoopCheck({ pr_check_sha: "old-sha" }, nextCheck),
    ).toMatchObject({
      headSha: "old-sha",
      name: "lore/implementation-loop",
      status: "completed",
      conclusion: "neutral",
      title: "Superseded",
    });
    expect(
      supersededLoopCheck({ pr_check_sha: "new-sha" }, nextCheck),
    ).toBeNull();
  });
});

function openPrVisit(): LoopVisitView {
  return planVisit("open-pr", {
    outcome: "success",
    produced: { pr_url: PR_URL },
  });
}

function loopRun(overrides: Partial<LoopRunView> = {}): LoopRunView {
  return {
    ...planRun({
      id: "694a406f",
      lineId: "implementation-loop",
      repo: "github.com/re-cinq/lore",
      outcome: null,
      finishedAt: null,
    }),
    args: { pr_number: 241 },
    ...overrides,
  };
}

function publishScene(opts: { liveHeadSha: string | null }) {
  const checks: CheckRunInput[] = [];
  const run = loopRun();
  const visits: LoopVisitView[] = [openPrVisit(), planVisit("tdd-round", null)];
  const deps: LoopProgressDeps = {
    run: () => Promise.resolve(run),
    visits: () => Promise.resolve(visits),
    openLoopRuns: () => Promise.resolve([run]),
    pullHeadSha: () => Promise.resolve(opts.liveHeadSha),
    upsertCheckRun: (_repo, input) => {
      checks.push(input);

      return Promise.resolve();
    },
  };

  return { checks, deps, run, visits };
}
