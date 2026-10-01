import { describe, expect, it } from "vitest";
import { recordedFloor } from "@re-cinq/lore-shared/floor/recorded-floor.js";
import { FloorRunReader } from "./floor-run-reader.js";
import type { RunView } from "@re-cinq/floor-client";
import type { FloorRequest } from "@re-cinq/lore-shared/floor/recorded-floor.js";
import { FLOOR_RUN, floorWithOneRun, PR_URL } from "./floor-run.fixtures.js";

const FINISHED_RUN: RunView = {
  ...FLOOR_RUN,
  id: "run-2",
  createdAt: "2026-09-30T09:00:00.000Z",
  outcome: "success",
  finishedAt: "2026-09-30T09:30:00.000Z",
};

function listingReader() {
  const recorded = recordedFloor(floorWithTwoRuns);

  return { reader: new FloorRunReader(recorded.floor), recorded };
}

function floorWithTwoRuns(request: FloorRequest): unknown {
  const url = new URL(request.path, "http://floor.test");

  if (url.pathname === "/costs") {
    return {
      items: [
        { key: "run-1", costUsd: 0.42 },
        { key: "run-2", costUsd: 1.5 },
      ],
    };
  }

  if (url.pathname === "/assembly-runs") {
    const open = url.searchParams.get("open") === "true";

    return { items: [open ? FLOOR_RUN : FINISHED_RUN], nextCursor: null };
  }

  return floorWithOneRun(request);
}

function reader() {
  const recorded = recordedFloor(floorWithOneRun);

  return { reader: new FloorRunReader(recorded.floor), recorded };
}

describe("FloorRunReader", () => {
  it("reads run-1 as a running code-review run stamped with the floor engine", async () => {
    expect(await reader().reader.getById("run-1")).toMatchObject({
      id: "run-1",
      blueprintName: "code-review",
      repo: "re-cinq/lore",
      branch: "fix/login",
      status: "running",
      args: { engine: "floor", pr_url: PR_URL, pr_number: 412 },
      createdAt: new Date("2026-09-30T10:00:00.000Z"),
    });
  });

  it("draws the line's agent node and its marker from the version the run started on", async () => {
    const run = await reader().reader.getById("run-1");

    expect(run?.graph?.nodes).toMatchObject([
      { id: "review", type: "agent" },
      { id: "done", type: "retrospective" },
    ]);
  });

  it("answers null for a run the floor does not have", async () => {
    expect(await reader().reader.getById("run-unknown")).toBeNull();
  });

  it("lists visit-1 as the running station run floor-visit-1", async () => {
    expect(await reader().reader.listStationRuns("run-1")).toMatchObject([
      {
        id: "visit-1",
        nodeId: "review",
        status: "running",
        agentCrName: "floor-visit-1",
      },
    ]);
  });

  it("lists no station run for a run the floor does not have", async () => {
    expect(await reader().reader.listStationRuns("run-unknown")).toEqual([]);
  });

  it("reads the one assistant turn of visit-1 as a turn row", async () => {
    expect(await reader().reader.turns("run-1")).toMatchObject([
      { id: "1", stationRunId: "visit-1", eventType: "assistant" },
    ]);
  });

  it("reads floor-visit-1's log as one available line of run-1", async () => {
    expect(
      await reader().reader.nodeLogs("run-1", "floor-visit-1", undefined),
    ).toMatchObject({
      available: true,
      logs: "2026-09-30T10:01:00.000Z kind=lifecycle tool=git phase=init status=running",
    });
  });

  it("answers null for floor-visit-1 asked of run-2, which it is no visit of", async () => {
    expect(
      await reader().reader.nodeLogs("run-2", "floor-visit-1", undefined),
    ).toBeNull();
  });

  it("answers null for a Lore pod's name cr-implement without asking the floor", async () => {
    const { reader: floorReader, recorded } = reader();

    expect(
      await floorReader.nodeLogs("run-1", "cr-implement", undefined),
    ).toBeNull();
    expect(recorded.requests).toEqual([]);
  });

  it("reads the run's cost as 0.42 dollars", async () => {
    expect(await reader().reader.costUsd("run-1")).toBe(0.42);
  });

  it("reads the line version once for two reads of the same run", async () => {
    const { reader: floorReader, recorded } = reader();

    await floorReader.getById("run-1");
    await floorReader.getById("run-1");

    expect(
      recorded.requests.filter((r) => r.path.includes("/versions/")),
    ).toHaveLength(1);
  });
});

describe("FloorRunReader.listSummaries", () => {
  it("lists run-1 as running and run-2 as finished when the query names no filter", async () => {
    const { reader: floorReader } = listingReader();

    expect(await floorReader.listSummaries({})).toMatchObject([
      { id: "run-1", status: "running" },
      { id: "run-2", status: "finished" },
    ]);
  });

  it("reads createdAt of run-2 from the run itself", async () => {
    const { reader: floorReader } = listingReader();
    const [, finished] = await floorReader.listSummaries({});

    expect(finished.createdAt).toEqual(new Date("2026-09-30T09:00:00.000Z"));
  });

  it("asks the floor for open runs of github.com/re-cinq/lore only for repo re-cinq/lore and status running", async () => {
    const { reader: floorReader, recorded } = listingReader();

    await floorReader.listSummaries({
      repo: "re-cinq/lore",
      status: ["running"],
      limit: 10,
    });

    expect(recorded.requests.map((request) => request.path)).toContain(
      "/assembly-runs?repo=github.com%2Fre-cinq%2Flore&open=true&limit=10",
    );
  });

  it("lists only run-1 for status running", async () => {
    const { reader: floorReader } = listingReader();
    const runs = await floorReader.listSummaries({ status: ["running"] });

    expect(runs.map((run) => run.id)).toEqual(["run-1"]);
  });

  it("asks the floor for the open and the finished runs on subject task_id:task-1 for task-1", async () => {
    const { reader: floorReader, recorded } = listingReader();

    await floorReader.listSummaries({ taskId: "task-1" });

    const listed = recorded.requests
      .map((request) => request.path)
      .filter((path) => path.startsWith("/assembly-runs?"));

    expect(listed).toEqual([
      "/assembly-runs?subject=task_id%3Atask-1&open=true&limit=50",
      "/assembly-runs?subject=task_id%3Atask-1&open=false&limit=50",
    ]);
  });

  it("reads the costs of run-1 and run-2 in one request", async () => {
    const { reader: floorReader, recorded } = listingReader();

    const costs = await floorReader.costsByRun([
      { id: "run-1", createdAt: new Date("2026-09-30T10:00:00.000Z") },
      { id: "run-2", createdAt: new Date("2026-09-30T09:00:00.000Z") },
    ]);

    expect([...costs]).toEqual([
      ["run-1", 0.42],
      ["run-2", 1.5],
    ]);
    expect(recorded.requests).toHaveLength(1);
  });

  it("asks for the cost of run-1 alone when it is the only run", async () => {
    const { reader: floorReader, recorded } = listingReader();

    await floorReader.costsByRun([
      { id: "run-1", createdAt: new Date("2026-09-30T10:00:00.000Z") },
    ]);

    expect(recorded.requests.map((request) => request.path)).toEqual([
      "/costs?run=run-1&group=run",
    ]);
  });
});
