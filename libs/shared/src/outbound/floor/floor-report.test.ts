import { describe, expect, it } from "vitest";
import { recordedFloor } from "./recorded-floor.js";
import { reportToVisit } from "./floor-report.js";

describe("reportToVisit", () => {
  it("posts station_run.reported for visit v-7 with the report, lore as the worker and one event per visit", async () => {
    const { floor, requests } = recordedFloor(() => ({ id: "e-1" }));

    await reportToVisit(floor.events, "v-7", {
      outcome: "changes_requested",
      produced: { plan_md: "hash-1" },
    });

    expect(requests).toEqual([
      {
        method: "POST",
        path: "/events",
        body: {
          name: "station_run.reported",
          payload: {
            visitId: "v-7",
            worker: "lore",
            report: {
              outcome: "changes_requested",
              produced: { plan_md: "hash-1" },
            },
          },
          dedupeKey: "station_run.reported:v-7",
        },
      },
    ]);
  });
});
