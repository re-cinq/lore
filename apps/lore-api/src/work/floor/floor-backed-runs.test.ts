import { describe, expect, it } from "vitest";
import type {
  AssemblyRunRecord,
  StationRunRecord,
} from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-port.js";
import {
  floorBackedRuns,
  runsOnFloor,
  type FloorRunReads,
} from "./floor-backed-runs.js";
import {
  floorRunToAssemblyRun,
  lineBodyToRunGraph,
  visitToStationRun,
} from "./floor-run-mapping.js";
import {
  FLOOR_LINE,
  FLOOR_RUN as FLOOR_RUN_VIEW,
  FLOOR_VISIT as FLOOR_VISIT_VIEW,
} from "./floor-run.fixtures.js";

const FLOOR_RUN = floorRunToAssemblyRun({
  run: { ...FLOOR_RUN_VIEW, id: "floor-1" },
  visits: [],
  graph: lineBodyToRunGraph("code-review", FLOOR_LINE, {}),
});
const LOCAL_RUN: AssemblyRunRecord = { ...FLOOR_RUN, id: "local-1", args: {} };
const FLOOR_VISIT = visitToStationRun(FLOOR_VISIT_VIEW, FLOOR_RUN);
const LOCAL_VISIT: StationRunRecord = { ...FLOOR_VISIT, id: "local-visit" };

function reads(
  run: AssemblyRunRecord,
  visit: StationRunRecord,
  listed: AssemblyRunRecord[] = [run],
): FloorRunReads {
  return {
    getById: (id) => Promise.resolve(id === run.id ? run : null),
    listStationRuns: (id) => Promise.resolve(id === run.id ? [visit] : []),
    listSummaries: () => Promise.resolve(listed),
  };
}

const runs = floorBackedRuns(
  reads(LOCAL_RUN, LOCAL_VISIT),
  reads(FLOOR_RUN, FLOOR_VISIT),
);

describe("floorBackedRuns", () => {
  it("answers local-1 from Postgres", async () => {
    expect(await runs.getById("local-1")).toBe(LOCAL_RUN);
  });

  it("answers floor-1 from the floor when Postgres has no such run", async () => {
    expect(await runs.getById("floor-1")).toBe(FLOOR_RUN);
  });

  it("answers null for a run neither has", async () => {
    expect(await runs.getById("nowhere")).toBeNull();
  });

  it("lists the local visit for local-1 and the floor's visit for floor-1", async () => {
    expect([
      await runs.listStationRuns("local-1"),
      await runs.listStationRuns("floor-1"),
    ]).toEqual([[LOCAL_VISIT], [FLOOR_VISIT]]);
  });
});

describe("floorBackedRuns listSummaries", () => {
  const older = {
    ...LOCAL_RUN,
    createdAt: new Date("2026-09-30T09:00:00.000Z"),
  };
  const newer = {
    ...FLOOR_RUN,
    createdAt: new Date("2026-09-30T11:00:00.000Z"),
  };
  const sameTimeHigherId = { ...older, id: "local-9" };
  const merged = floorBackedRuns(
    reads(older, LOCAL_VISIT, [older, sameTimeHigherId]),
    reads(newer, FLOOR_VISIT),
  );

  it("lists the floor run then local-9 then local-1 for runs created at eleven then nine twice", async () => {
    const listed = await merged.listSummaries({});

    expect(listed.map((run) => run.id)).toEqual([
      "floor-1",
      "local-9",
      "local-1",
    ]);
  });

  it("lists local-9 and local-1 alone when the floor's list is out of reach", async () => {
    const lost = floorBackedRuns(
      reads(older, LOCAL_VISIT, [older, sameTimeHigherId]),
      {
        ...reads(newer, FLOOR_VISIT),
        listSummaries: () => Promise.reject(new Error("floor down")),
      },
    );
    const listed = await lost.listSummaries({});

    expect(listed.map((run) => run.id)).toEqual(["local-9", "local-1"]);
  });

  it("slices the merged list to the limit of 2", async () => {
    const listed = await merged.listSummaries({ limit: 2 });

    expect(listed.map((run) => run.id)).toEqual(["floor-1", "local-9"]);
  });
});

describe("runsOnFloor", () => {
  it("is true for a run whose args carry engine floor", () => {
    expect(runsOnFloor(FLOOR_RUN)).toBe(true);
  });

  it("is false for a run Postgres answered", () => {
    expect(runsOnFloor(LOCAL_RUN)).toBe(false);
  });
});
