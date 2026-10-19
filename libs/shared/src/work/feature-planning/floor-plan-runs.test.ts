import { describe, expect, it } from "vitest";

import {
  planRun,
  planVisit,
  recordedPlanFloor,
} from "../../outbound/floor/recorded-plan-floor.js";
import { floorPlanLineState, visitParkedOnSpecPr } from "./floor-plan-runs.js";

const REPO = "re-cinq/lore";
const SPEC_PR_URL = "https://github.com/re-cinq/lore/pull/12";

const SUCCESS = { outcome: "success" };

const PARKED_ON_AUTHOR = [
  planVisit("analyze", SUCCESS),
  planVisit("plan-pass-end", SUCCESS),
  planVisit("author", null),
];

const PARKED_ON_MERGED = [
  planVisit("author", SUCCESS),
  planVisit("open-spec-pr", {
    outcome: "success",
    produced: { pr_url: SPEC_PR_URL },
  }),
  planVisit("merged", null),
];

const PLAN_KEY = { repo: REPO, planId: "p1" };

describe("floorPlanLineState", () => {
  it("asks the floor for the feature-planning runs of github.com/re-cinq/lore on subject plan_id:p1", async () => {
    const { floor, requests } = recordedPlanFloor({ runs: [], visits: {} });

    await floorPlanLineState(floor, PLAN_KEY);

    expect(requests).toEqual([
      {
        method: "GET",
        path: "/assembly-runs?repo=github.com%2Fre-cinq%2Flore&line=feature-planning&subject=plan_id%3Ap1",
        body: null,
      },
    ]);
  });

  it("answers null when the floor holds no run for plan p1", async () => {
    const { floor } = recordedPlanFloor({ runs: [], visits: {} });

    expect(await floorPlanLineState(floor, PLAN_KEY)).toBeNull();
  });

  it("reads the open run run-open rather than the finished run run-done that came after it", async () => {
    const finished = planRun({
      id: "run-done",
      outcome: "success",
      finishedAt: "2026-10-01T10:00:00.000Z",
    });
    const { floor } = recordedPlanFloor({
      runs: [finished, planRun()],
      visits: { "run-open": PARKED_ON_AUTHOR },
    });

    expect(await floorPlanLineState(floor, PLAN_KEY)).toMatchObject({
      lineId: "run-open",
      status: "open",
    });
  });

  it("parks on author at the visit that has no report yet", async () => {
    const { floor } = recordedPlanFloor({
      runs: [planRun()],
      visits: { "run-open": PARKED_ON_AUTHOR },
    });

    expect(await floorPlanLineState(floor, PLAN_KEY)).toMatchObject({
      open: "author",
      parkedAuthor: {
        lineId: "run-open",
        nodeId: "author",
        iteration: 1,
        visitId: "visit-author",
      },
      parkedMerged: null,
    });
  });

  it("is on analyze and parked nowhere while the agent's analyze visit is open", async () => {
    const { floor } = recordedPlanFloor({
      runs: [planRun()],
      visits: {
        "run-open": [planVisit("author", SUCCESS), planVisit("analyze", null)],
      },
    });

    expect(await floorPlanLineState(floor, PLAN_KEY)).toMatchObject({
      open: "analyze",
      parkedAuthor: null,
    });
  });

  it("is on validate and not parked on author once the author visit was reported and validate opened", async () => {
    const { floor } = recordedPlanFloor({
      runs: [planRun()],
      visits: {
        "run-open": [
          planVisit("author", { outcome: "cancelled" }),
          planVisit("validate", null),
        ],
      },
    });

    expect(await floorPlanLineState(floor, PLAN_KEY)).toMatchObject({
      open: "validate",
      parkedAuthor: null,
    });
  });

  it("stays on the node it last left when the run is open between two visits", async () => {
    const { floor } = recordedPlanFloor({
      runs: [planRun()],
      visits: { "run-open": [planVisit("analyze", SUCCESS)] },
    });

    expect(await floorPlanLineState(floor, PLAN_KEY)).toMatchObject({
      open: "analyze",
    });
  });

  it("parks on merged with spec PR 12 from what open-spec-pr produced", async () => {
    const { floor } = recordedPlanFloor({
      runs: [planRun()],
      visits: { "run-open": PARKED_ON_MERGED },
    });

    expect(await floorPlanLineState(floor, PLAN_KEY)).toMatchObject({
      prUrl: SPEC_PR_URL,
      prNumber: 12,
      parkedMerged: { nodeId: "merged", visitId: "visit-merged" },
      merged: false,
    });
  });

  it("reads merged as true once the merged visit reported success", async () => {
    const { floor } = recordedPlanFloor({
      runs: [planRun()],
      visits: {
        "run-open": [
          ...PARKED_ON_MERGED.slice(0, 2),
          planVisit("merged", SUCCESS),
          planVisit("decompose", null),
        ],
      },
    });

    expect(await floorPlanLineState(floor, PLAN_KEY)).toMatchObject({
      merged: true,
      parkedMerged: null,
      open: "decompose",
    });
  });

  it("reads the branch lore/feature-planning/p1 from the run's repo start item", async () => {
    const { floor } = recordedPlanFloor({ runs: [planRun()], visits: {} });

    expect(await floorPlanLineState(floor, PLAN_KEY)).toMatchObject({
      branch: "lore/feature-planning/p1",
    });
  });

  it("reads no branch from a repo start item that names none", async () => {
    const bare = planRun({
      startItems: {
        repo: { kind: "git", ref: "github.com/re-cinq/lore", by: "lore" },
      },
    });
    const { floor } = recordedPlanFloor({ runs: [bare], visits: {} });

    expect(await floorPlanLineState(floor, PLAN_KEY)).toMatchObject({
      branch: null,
    });
  });

  it("is finished with its success outcome and parked nowhere once the run ended", async () => {
    const finished = planRun({
      outcome: "success",
      finishedAt: "2026-10-01T10:00:00.000Z",
    });
    const { floor } = recordedPlanFloor({
      runs: [finished],
      visits: { "run-open": PARKED_ON_AUTHOR },
    });

    expect(await floorPlanLineState(floor, PLAN_KEY)).toMatchObject({
      status: "finished",
      outcome: "success",
      open: null,
      parkedAuthor: null,
    });
  });
});

describe("visitParkedOnSpecPr", () => {
  it("asks the floor for the open feature-planning runs of github.com/re-cinq/lore", async () => {
    const { floor, requests } = recordedPlanFloor({ runs: [], visits: {} });

    await visitParkedOnSpecPr(floor, { repo: REPO, prNumber: 12 });

    expect(requests.map((request) => request.path)).toEqual([
      "/assembly-runs?repo=github.com%2Fre-cinq%2Flore&line=feature-planning&open=true",
    ]);
  });

  it("finds the visit parked on merged in the run whose spec PR is 12", async () => {
    const { floor } = recordedPlanFloor({
      runs: [planRun()],
      visits: { "run-open": PARKED_ON_MERGED },
    });

    expect(
      await visitParkedOnSpecPr(floor, { repo: REPO, prNumber: 12 }),
    ).toEqual({
      lineId: "run-open",
      nodeId: "merged",
      iteration: 1,
      visitId: "visit-merged",
    });
  });

  it("finds nothing for PR 13 when the run parked on merged holds PR 12", async () => {
    const { floor } = recordedPlanFloor({
      runs: [planRun()],
      visits: { "run-open": PARKED_ON_MERGED },
    });

    expect(
      await visitParkedOnSpecPr(floor, { repo: REPO, prNumber: 13 }),
    ).toBeNull();
  });

  it("finds nothing for PR 12 when its run is parked on author", async () => {
    const reopened = [
      ...PARKED_ON_MERGED.slice(0, 2),
      planVisit("merged", { outcome: "changes_requested" }),
      planVisit("author", null),
    ];
    const { floor } = recordedPlanFloor({
      runs: [planRun()],
      visits: { "run-open": reopened },
    });

    expect(
      await visitParkedOnSpecPr(floor, { repo: REPO, prNumber: 12 }),
    ).toBeNull();
  });
});
