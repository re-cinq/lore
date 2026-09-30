import { describe, expect, it } from "vitest";
import { recordedFloor } from "@re-cinq/lore-shared/floor/recorded-floor.js";
import { FloorRunReader } from "./floor-run-reader.js";
import { floorWithOneRun, PR_URL } from "./floor-run.fixtures.js";

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
