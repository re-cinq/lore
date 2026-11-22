import { describe, expect, it } from "vitest";
import {
  PLAN_BLOB_HASH,
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

const PARKED_AFTER_A_ROUND = [
  OPENED,
  planVisit("tdd-round", {
    outcome: "success",
    produced: {
      tdd_done: "parses the header",
      tdd_next: "reject an empty body",
    },
  }),
  planVisit("await-ci", null),
];

const PARKED_ON_PR = [OPENED, planVisit("await-pr", null)];

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
    judgePr: () => Promise.resolve({ outcome: "failed", args: {} }),
    judgeMerge: () => Promise.resolve(null),
    prState: () => Promise.resolve("open"),
    ...overrides,
  };
  const writes = () =>
    recorded.requests.filter(
      ({ method, path }) => method === "POST" && path !== "/blobs",
    );

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
  it("asks the floor for the open runs of the onboard, implementation-loop, spec-upkeep and auto-merge lines", async () => {
    const { deps, requests } = scene();

    await floorCiWaitSweep(deps);

    expect(requests.slice(0, 4).map((request) => request.path)).toEqual([
      "/assembly-runs?line=onboard&open=true",
      "/assembly-runs?line=implementation-loop&open=true",
      "/assembly-runs?line=spec-upkeep&open=true",
      "/assembly-runs?line=auto-merge&open=true",
    ]);
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
          round_brief: PLAN_BLOB_HASH,
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

  it("stores the red verdict and the last round's hand-off as the round brief file", async () => {
    const { deps, requests } = scene(PARKED_AFTER_A_ROUND, {
      judge: () => Promise.resolve(RED),
    });

    await floorCiWaitSweep(deps);
    const stored = requests.find((request) => request.path === "/blobs");

    expect(stored?.method).toBe("POST");
    expect(String(stored?.body)).toContain(
      "## CI reported failures on deadbeef",
    );
    expect(String(stored?.body)).toContain(
      "- Done: parses the header\n- Next: reject an empty body",
    );
  });

  it("judges a run parked on await-pr with the pull request reader and reports its verdict", async () => {
    const { deps, judged, writes } = scene(PARKED_ON_PR, {
      judgePr: () => Promise.resolve({ outcome: "success", args: {} }),
    });

    await floorCiWaitSweep(deps);

    expect(judged).toEqual([]);
    expect(writes()).toEqual([reportedOn("visit-await-pr", SUCCESS)]);
  });

  it("stores Lore's findings on cafe1234 as the round brief file when Lore's review sends await-pr to the fix", async () => {
    const { deps, writes, requests } = scene(PARKED_ON_PR, {
      judgePr: () =>
        Promise.resolve({
          outcome: "changes_requested",
          args: {
            reason: "review_changes_requested",
            review_feedback_sha: "cafe1234",
            review_feedback: "src/a.ts:4: the null check is inverted",
          },
        }),
    });

    await floorCiWaitSweep(deps);
    const stored = requests.find((request) => request.path === "/blobs");

    expect(String(stored?.body)).toContain(
      "## Lore's review asked for changes on cafe1234",
    );
    expect(writes()).toEqual([
      reportedOn("visit-await-pr", {
        outcome: "changes_requested",
        produced: { round_brief: PLAN_BLOB_HASH },
      }),
    ]);
  });

  it("reports failed with no produced value when await-pr is blocked on unresolved threads", async () => {
    const { deps, writes } = scene(PARKED_ON_PR, {
      judgePr: () =>
        Promise.resolve({
          outcome: "failed",
          args: { reason: "unresolved_threads" },
        }),
    });

    await floorCiWaitSweep(deps);

    expect(writes()).toEqual([
      reportedOn("visit-await-pr", { outcome: "failed" }),
    ]);
  });

  it("judges an auto-merge run parked on await-merge as the pull request its start item names, and reports its success with nothing produced", async () => {
    const recorded = recordedPlanFloor({
      runs: [
        planRun({
          id: "run-merge",
          lineId: "auto-merge",
          repo: "github.com/re-cinq/app",
          startItems: {
            repo: {
              kind: "git",
              ref: "github.com/re-cinq/app@fix",
              by: "lore",
            },
            pr_url: { kind: "value", ref: PR_URL, by: "lore" },
          },
        }),
      ],
      visits: { "run-merge": [planVisit("await-merge", null)] },
    });
    const merged: LoopRunSlice[] = [];
    const deps: FloorCiWaitDeps = {
      floor: recorded.floor,
      judge: () => Promise.resolve(null),
      judgePr: () => Promise.resolve(null),
      judgeMerge: (run) => {
        merged.push(run);

        return Promise.resolve({ outcome: "success", args: {} });
      },
      prState: () => Promise.resolve("open"),
    };

    await floorCiWaitSweep(deps);

    expect({
      judged: merged.map((run) => [run.id, run.args.pr_number]),
      blobs: recorded.requests.filter((request) => request.path === "/blobs"),
      writes: recorded.requests
        .filter((request) => request.path === "/events")
        .map((request) => request.body),
    }).toEqual({
      judged: [["run-merge", 42]],
      blobs: [],
      writes: [reportedOn("visit-await-merge", { outcome: "success" }).body],
    });
  });

  describe("an implementation-loop run whose acceptance test could not run", () => {
    const YAML_MANIFEST_FAILURE =
      "ci_identity.acceptance_test.go:274: run: parsing test-commands manifest: yaml: did not find expected key";
    const HANDOFF_ASSERTION_FAILURE =
      "apps/lore-api/src/transport/routes/auth/app-sign-in-hardening.acceptance.test.ts:280 AssertionError: expected { handoffCount: 1 } to deeply equal { handoffCount: +0 }";
    const redWith = (summary: string) => ({
      outcome: "changes_requested" as const,
      args: {
        reason: "ci_red",
        ci_feedback_sha: "deadbeef",
        ci_failed_checks: "lore-code-trace",
        ci_failure_summary: summary,
      },
    });
    const sweepOn = async (lineId: string, summary: string) => {
      const recorded = recordedPlanFloor({
        runs: [
          planRun({ id: "run-loop", lineId, repo: "github.com/re-cinq/app" }),
        ],
        visits: { "run-loop": PARKED_AFTER_A_ROUND },
      });

      await floorCiWaitSweep({
        floor: recorded.floor,
        judge: () => Promise.resolve(redWith(summary)),
        judgePr: () => Promise.resolve(null),
        judgeMerge: () => Promise.resolve(null),
        prState: () => Promise.resolve("open"),
      });

      return recorded.requests.filter(
        ({ method, path }) => method === "POST" && path !== "/blobs",
      );
    };
    const produced = (summary: string) => ({
      ci_feedback_sha: "deadbeef",
      ci_failed_checks: "lore-code-trace",
      ci_failure_summary: summary,
      round_brief: PLAN_BLOB_HASH,
    });

    it("reports test_broken with the dod feedback when #12's yaml manifest line shows the acceptance test could not run", async () => {
      expect(
        await sweepOn("implementation-loop", YAML_MANIFEST_FAILURE),
      ).toEqual([
        reportedOn("visit-await-ci", {
          outcome: "test_broken",
          produced: {
            ...produced(YAML_MANIFEST_FAILURE),
            dod_feedback: PLAN_BLOB_HASH,
          },
        }),
      ]);
    });

    it("reports changes_requested for #52's handoffCount assertion, the red a round owes", async () => {
      expect(
        await sweepOn("implementation-loop", HANDOFF_ASSERTION_FAILURE),
      ).toEqual([
        reportedOn("visit-await-ci", {
          outcome: "changes_requested",
          produced: produced(HANDOFF_ASSERTION_FAILURE),
        }),
      ]);
    });

    it("reports changes_requested on an onboard run, whose line has no definition of done to send it to", async () => {
      expect(await sweepOn("onboard", YAML_MANIFEST_FAILURE)).toEqual([
        reportedOn("visit-await-ci", {
          outcome: "changes_requested",
          produced: produced(YAML_MANIFEST_FAILURE),
        }),
      ]);
    });
  });
});
