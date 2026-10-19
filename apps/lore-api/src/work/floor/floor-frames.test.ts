import { describe, expect, it } from "vitest";
import { recordedFloor } from "@re-cinq/lore-shared/floor/recorded-floor.js";
import type { LiveFrame } from "@re-cinq/floor-client";
import { floorFrames } from "./floor-frames.js";
import { FloorRunReader } from "./floor-run-reader.js";
import {
  FLOOR_RUN,
  FLOOR_VISIT,
  floorWithOneRun,
  SECRET_PROMPT,
  turnFrame,
} from "./floor-run.fixtures.js";

async function run() {
  const reader = new FloorRunReader(recordedFloor(floorWithOneRun).floor);

  return (await reader.getById("run-1"))!;
}

describe("floorFrames", () => {
  it("turns the assistant turn at seq 7 into agent event 700 of visit-1", async () => {
    expect(floorFrames(turnFrame(7), await run())).toMatchObject([
      {
        type: "agent_event",
        event: {
          id: "700",
          assemblyLineId: "run-1",
          stationRunId: "visit-1",
          nodeId: "review",
          agentCrName: "floor-visit-1",
          createdAt: new Date("2026-09-30T10:05:00.000Z"),
        },
      },
    ]);
  });

  it("drops a log record, which the run page does not draw", async () => {
    const frame = turnFrame(7);
    const log = { ...frame, record: { ...frame.record, kind: "log" as const } };

    expect(floorFrames(log, await run())).toEqual([]);
  });

  it("turns an opened visit into a node status that carries no prompt", async () => {
    const frames = floorFrames(
      { type: "visit_opened", seq: 2, visit: FLOOR_VISIT },
      await run(),
    );

    expect(frames).toMatchObject([
      { type: "node_status", node: { node_id: "review" } },
    ]);
    expect(JSON.stringify(frames)).not.toContain(SECRET_PROMPT);
  });

  it("turns a run settled as error into a failed run status", async () => {
    const settled = {
      ...FLOOR_RUN,
      outcome: "error",
      reason: "review: iteration limit",
      finishedAt: "2026-09-30T10:20:00.000Z",
    };

    expect(
      floorFrames({ type: "run_settled", seq: 9, run: settled }, await run()),
    ).toMatchObject([
      {
        type: "run_status",
        run: { id: "run-1", status: "failed", outcome: "error" },
      },
    ]);
  });

  it("turns caught_up at seq 9 into catchup_complete at 900", async () => {
    expect(floorFrames({ type: "caught_up", seq: 9 }, await run())).toEqual([
      { type: "catchup_complete", last_id: "900" },
    ]);
  });

  it("sends nothing for an unsupported frame", async () => {
    expect(floorFrames({ type: "unsupported" }, await run())).toEqual([]);
  });

  it("turns a run a start by hand reopened into a running run status", async () => {
    expect(
      floorFrames(
        { type: "run_reopened", seq: 11, run: FLOOR_RUN },
        await run(),
      ),
    ).toMatchObject([
      { type: "run_status", run: { id: "run-1", status: "running" } },
    ]);
  });

  it("sends nothing for a frame type the floor adds later, rather than throwing", async () => {
    const later = {
      type: "a_frame_from_a_newer_floor",
      seq: 12,
    } as unknown as LiveFrame;

    expect(floorFrames(later, await run())).toEqual([]);
  });
});
