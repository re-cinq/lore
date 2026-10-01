import { describe, expect, it } from "vitest";
import {
  planRun,
  planVisit,
  recordedPlanFloor,
} from "@re-cinq/lore-shared/floor/recorded-plan-floor.js";
import { floorCiWaitSweep, type FloorCiWaitDeps } from "./floor-ci-wait.js";
import type { LoopRunSlice } from "./sweep-contract.js";

const PR_URL = "https://github.com/re-cinq/app/pull/42";
const SUCCESS = { outcome: "success" };
const OPENED = planVisit("open-pr", {
  outcome: "success",
  produced: { pr_url: PR_URL },
});
const RED = {
  outcome: "changes_requested" as const,
  args: {
    reason: "ci_red",
    ci_feedback_sha: "deadbeef",
    ci_failed_checks: "lint",
    ci_failure_summary: "no-unused-vars",
  },
};

const PARKED_ON_CI = [
  planVisit("author", SUCCESS),
  OPENED,
  planVisit("await-ci", null),
];

const PARKED_AGAIN_AFTER_A_FIX = [
  OPENED,
  planVisit(
    "await-ci",
    { outcome: "changes_requested", produced: { ci_feedback_sha: "deadbeef" } },
    { id: "visit-await-ci-1" },
  ),
  planVisit("fix-ci", SUCCESS),
  planVisit("await-ci", null, { iteration: 2 }),
];

const ONBOARD_RUN = planRun({
  id: "run-onboard",
  lineId: "onboard",
  repo: "github.com/re-cinq/app",
});

function scene(
  visits = PARKED_ON_CI,
  overrides: Partial<Omit<FloorCiWaitDeps, "floor">> = {},
) {
  const recorded = recordedPlanFloor({
    runs: [ONBOARD_RUN],
    visits: { "run-onboard": visits },
  });
  const judged: LoopRunSlice[] = [];
  const deps: FloorCiWaitDeps = {
    floor: recorded.floor,
    judge: (run) => {
      judged.push(run);

      return Promise.resolve({ outcome: "success", args: {} });
    },
    prState: () => Promise.resolve("open"),
    ...overrides,
  };
  const writes = () =>
    recorded.requests.filter((request) => request.method === "POST");

  return { deps, judged, writes, requests: recorded.requests };
}

function reportedOn(visitId: string, report: unknown) {
  return {
    method: "POST",
    path: "/events",
    body: {
      name: "station_run.reported",
      payload: { visitId, worker: "lore", report },
      dedupeKey: `station_run.reported:${visitId}`,
    },
  };
}

describe("floorCiWaitSweep", () => {
  it("asks the floor for the open runs of the onboard line", async () => {
    const { deps, requests } = scene();

    await floorCiWaitSweep(deps);

    expect(requests[0]).toEqual({
      method: "GET",
      path: "/assembly-runs?line=onboard&open=true",
      body: null,
    });
  });

  it("judges run-onboard as pull request 42 of re-cinq/app, with no red sha reported yet", async () => {
    const { deps, judged } = scene();

    await floorCiWaitSweep(deps);

    expect(judged).toEqual([
      {
        id: "run-onboard",
        blueprintName: "onboard",
        repo: "re-cinq/app",
        status: "running",
        args: { pr_number: 42 },
        graph: null,
      },
    ]);
  });

  it("reports success on the await-ci visit when the build is green", async () => {
    const { deps, writes } = scene();

    const summary = await floorCiWaitSweep(deps);

    expect(writes()).toEqual([reportedOn("visit-await-ci", SUCCESS)]);
    expect(summary).toBe(
      "floor: checked 1, resumed 1, blocked 0, waiting 0, closed 0",
    );
  });

  it("reports changes_requested with the failing checks as produced values when the build is red", async () => {
    const { deps, writes } = scene(PARKED_ON_CI, {
      judge: () => Promise.resolve(RED),
    });

    const summary = await floorCiWaitSweep(deps);

    expect(writes()).toEqual([
      reportedOn("visit-await-ci", {
        outcome: "changes_requested",
        produced: {
          ci_feedback_sha: "deadbeef",
          ci_failed_checks: "lint",
          ci_failure_summary: "no-unused-vars",
        },
      }),
    ]);
    expect(summary).toBe(
      "floor: checked 1, resumed 0, blocked 1, waiting 0, closed 0",
    );
  });

  it("reports nothing while the build is still running", async () => {
    const { deps, writes } = scene(PARKED_ON_CI, {
      judge: () => Promise.resolve(null),
    });

    const summary = await floorCiWaitSweep(deps);

    expect(writes()).toEqual([]);
    expect(summary).toBe(
      "floor: checked 1, resumed 0, blocked 0, waiting 1, closed 0",
    );
  });

  it("hands the judge the sha deadbeef the earlier await-ci visit reported red", async () => {
    const { deps, judged } = scene(PARKED_AGAIN_AFTER_A_FIX);

    await floorCiWaitSweep(deps);

    expect(judged[0].args).toEqual({
      pr_number: 42,
      ci_feedback_sha: "deadbeef",
    });
  });

  it("skips a run that is not parked on await-ci", async () => {
    const { deps, judged, writes } = scene([planVisit("author", null)]);

    const summary = await floorCiWaitSweep(deps);

    expect(judged).toEqual([]);
    expect(writes()).toEqual([]);
    expect(summary).toBe(
      "floor: checked 0, resumed 0, blocked 0, waiting 0, closed 0",
    );
  });

  it("cancels the run when its pull request was closed without merging", async () => {
    const { deps, judged, writes } = scene(PARKED_ON_CI, {
      prState: () => Promise.resolve("closed"),
    });

    const summary = await floorCiWaitSweep(deps);

    expect(writes()).toEqual([
      {
        method: "POST",
        path: "/assembly-runs/run-onboard/cancel",
        body: { reason: "the pull request was closed without merging" },
      },
    ]);
    expect(judged).toEqual([]);
    expect(summary).toBe(
      "floor: checked 1, resumed 0, blocked 0, waiting 0, closed 1",
    );
  });

  it("reports success without judging the build when the pull request already merged", async () => {
    const { deps, judged, writes } = scene(PARKED_ON_CI, {
      prState: () => Promise.resolve("merged"),
    });

    await floorCiWaitSweep(deps);

    expect(writes()).toEqual([reportedOn("visit-await-ci", SUCCESS)]);
    expect(judged).toEqual([]);
  });

  it("counts a run whose judgement throws as an error and still checks the rest", async () => {
    const { deps } = scene(PARKED_ON_CI, {
      judge: () => Promise.reject(new Error("GitHub 502")),
    });

    expect(await floorCiWaitSweep(deps)).toBe(
      "floor: checked 1, resumed 0, blocked 0, waiting 0, closed 0, errors 1",
    );
  });
});
