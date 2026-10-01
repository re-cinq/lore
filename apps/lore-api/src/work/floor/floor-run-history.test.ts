import { describe, expect, it } from "vitest";
import type {
  LiveFrame,
  RunWatch,
  WatchEnd,
  WatchOptions,
} from "@re-cinq/floor-client";
import { floorRunHistory } from "./floor-run-history.js";
import { FLOOR_VISIT, turnFrame } from "./floor-run.fixtures.js";

function scriptedWatch(
  frames: LiveFrame[],
  end: WatchEnd = { reason: "settled" },
) {
  const asked: Array<WatchOptions | undefined> = [];
  const stopped: string[] = [];
  const watch = (runId: string, options?: WatchOptions): RunWatch => {
    asked.push(options);

    return {
      seq: 0,
      ended: Promise.resolve(end),
      stop: () => stopped.push(runId),
      async *[Symbol.asyncIterator]() {
        yield* frames;
      },
    };
  };

  return { watch, asked, stopped };
}

function secondVisitTurn(seq: number): LiveFrame {
  const frame = turnFrame(seq);

  return {
    ...frame,
    visitId: "visit-2",
    iteration: 2,
    record: { ...frame.record, visitId: "visit-2", seq: 1 },
  };
}

function ids(events: { id: string }[]): string[] {
  return events.map((event) => event.id);
}

describe("floorRunHistory", () => {
  it("numbers a second visit's first turn after the first visit's, by the journal: events 300 then 900", async () => {
    const { watch } = scriptedWatch([
      turnFrame(3),
      { type: "visit_opened", seq: 8, visit: FLOOR_VISIT },
      secondVisitTurn(9),
      { type: "caught_up", seq: 9 },
    ]);

    expect(ids(await floorRunHistory(watch, "run-1", undefined))).toEqual([
      "300",
      "900",
    ]);
  });

  it("places the second visit's turn on visit-2 at iteration 2", async () => {
    const { watch } = scriptedWatch([
      secondVisitTurn(9),
      { type: "caught_up", seq: 9 },
    ]);

    expect(await floorRunHistory(watch, "run-1", undefined)).toMatchObject([
      { stationRunId: "visit-2", iteration: 2, agentCrName: "floor-visit-2" },
    ]);
  });

  it("asks the journal for what follows seq 3 for cursor 300, and for the whole run for none", async () => {
    const { watch, asked } = scriptedWatch([{ type: "caught_up", seq: 3 }]);

    await floorRunHistory(watch, "run-1", "300");
    await floorRunHistory(watch, "run-1", undefined);

    expect(asked).toEqual([{ after: 3 }, { after: undefined }]);
  });

  it("stops watching run-1 once the journal has caught up, leaving what comes later to the live channel", async () => {
    const { watch, stopped } = scriptedWatch([
      turnFrame(3),
      { type: "caught_up", seq: 3 },
      turnFrame(4),
    ]);

    const events = await floorRunHistory(watch, "run-1", undefined);

    expect({ ids: ids(events), stopped }).toEqual({
      ids: ["300"],
      stopped: ["run-1"],
    });
  });

  it("stops watching run-1 even when reading the journal throws", async () => {
    const stopped: string[] = [];
    const failing = (runId: string): RunWatch => ({
      seq: 0,
      ended: Promise.resolve({ reason: "stopped" }),
      stop: () => stopped.push(runId),
      // eslint-disable-next-line require-yield -- the journal that fails before its first frame
      async *[Symbol.asyncIterator]() {
        throw new Error("socket dropped");
      },
    });

    await expect(floorRunHistory(failing, "run-1", undefined)).rejects.toThrow(
      new Error("socket dropped"),
    );
    expect(stopped).toEqual(["run-1"]);
  });

  it("answers no event for a run the floor refuses to watch", async () => {
    const { watch } = scriptedWatch([], {
      reason: "refused",
      code: 4404,
      detail: "no run",
    });

    expect(await floorRunHistory(watch, "run-unknown", undefined)).toEqual([]);
  });
});
