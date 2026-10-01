import { describe, expect, it } from "vitest";
import {
  planRun,
  planVisit,
  recordedPlanFloor,
} from "@re-cinq/lore-shared/floor/recorded-plan-floor.js";
import {
  FLOOR_PLAN_EVENTS,
  closedSpecPrOf,
  floorPlanHandlers,
} from "./floor-plan-handlers.js";

const SUCCESS = { outcome: "success" };
const SPEC_PR_URL = "https://github.com/re-cinq/lore/pull/12";

const ON_MERGED = [
  planVisit("author", SUCCESS),
  planVisit("open-spec-pr", {
    outcome: "success",
    produced: { pr_url: SPEC_PR_URL },
  }),
  planVisit("merged", null),
];

const ON_AUTHOR_AFTER_MERGED = [
  ...ON_MERGED.slice(0, 2),
  planVisit("merged", { outcome: "changes_requested" }),
  planVisit("author", null),
];

function scene(visits = ON_MERGED) {
  const recorded = recordedPlanFloor({
    runs: [planRun()],
    visits: { "run-open": visits },
  });
  const handlers = floorPlanHandlers({ floor: () => recorded.floor });
  const close = (params: Record<string, unknown>) =>
    handlers.get("github.pull_request.closed")!({
      repo: "re-cinq/lore",
      pr_number: 12,
      merged: true,
      base_ref: "main",
      ...params,
    });
  const writes = () =>
    recorded.requests.filter((request) => request.method === "POST");

  return { handlers, close, writes };
}

describe("floorPlanHandlers", () => {
  it("answers github.pull_request.closed, the one event it asks the bus for", () => {
    const { handlers } = scene();

    expect([...handlers.keys()]).toEqual([...FLOOR_PLAN_EVENTS]);
  });

  it("reports success on the merged visit when spec PR 12 merged", async () => {
    const { close, writes } = scene();

    await close({ merged: true });

    expect(writes()).toEqual([
      {
        method: "POST",
        path: "/events",
        body: {
          name: "station_run.reported",
          payload: {
            visitId: "visit-merged",
            worker: "lore",
            report: { outcome: "success" },
          },
          dedupeKey: "station_run.reported:visit-merged",
        },
      },
    ]);
  });

  it("reports failed on the merged visit when spec PR 12 closed without merging", async () => {
    const { close, writes } = scene();

    await close({ merged: false });

    expect(writes()).toMatchObject([
      { body: { payload: { report: { outcome: "failed" } } } },
    ]);
  });

  it("reports nothing for PR 13 when the run parked on merged holds PR 12", async () => {
    const { close, writes } = scene();

    await close({ pr_number: 13 });

    expect(writes()).toEqual([]);
  });

  it("reports nothing for PR 12 when its run already waits on its author again", async () => {
    const { close, writes } = scene(ON_AUTHOR_AFTER_MERGED);

    await close({});

    expect(writes()).toEqual([]);
  });

  it("asks the floor nothing for a close that names no pull request", async () => {
    const recorded = recordedPlanFloor();
    const handlers = floorPlanHandlers({ floor: () => recorded.floor });

    await handlers.get("github.pull_request.closed")!({ repo: "re-cinq/lore" });

    expect(recorded.requests).toEqual([]);
  });
});

describe("closedSpecPrOf", () => {
  it("reads a merged PR 12 of re-cinq/lore as success", () => {
    expect(
      closedSpecPrOf({ repo: "re-cinq/lore", pr_number: 12, merged: true }),
    ).toEqual({ repo: "re-cinq/lore", prNumber: 12, outcome: "success" });
  });

  it("reads PR 12 closed without a merge as failed", () => {
    expect(
      closedSpecPrOf({ repo: "re-cinq/lore", pr_number: 12, merged: false }),
    ).toEqual({ repo: "re-cinq/lore", prNumber: 12, outcome: "failed" });
  });

  it("reads a close whose repo is missing as nothing to tell", () => {
    expect(closedSpecPrOf({ pr_number: 12, merged: true })).toBeNull();
  });
});
