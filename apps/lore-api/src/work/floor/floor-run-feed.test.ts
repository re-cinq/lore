import { describe, expect, it } from "vitest";
import type {
  LiveFrame,
  RunWatch,
  WatchEnd,
  WatchOptions,
} from "@re-cinq/floor-client";
import { recordedFloor } from "@re-cinq/lore-shared/floor/recorded-floor.js";
import { RecordingSink } from "../assembly-line-station/frame-sink.js";
import { FloorRunFeeds } from "./floor-run-feed.js";
import { FloorRunReader } from "./floor-run-reader.js";
import { floorWithOneRun, turnFrame } from "./floor-run.fixtures.js";

const SETTLED: WatchEnd = { reason: "settled" };

async function joined(
  frames: LiveFrame[],
  given: { after?: string; end?: WatchEnd; sink?: RecordingSink } = {},
) {
  const reader = new FloorRunReader(recordedFloor(floorWithOneRun).floor);
  const scripted = scriptedWatch(frames, given.end);
  const sink = given.sink ?? new RecordingSink();
  const feeds = new FloorRunFeeds({ watch: scripted.watch, runs: reader });
  const run = (await reader.getById("run-1"))!;
  const membership = feeds.join(run, sink, given.after ?? "0");

  await membership.ready;

  return { sink, membership, ...scripted };
}

function scriptedWatch(frames: LiveFrame[], end: WatchEnd = SETTLED) {
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

describe("FloorRunFeeds", () => {
  it("sends the run, its visit, the replayed turn and then catchup_complete", async () => {
    const { sink } = await joined([
      turnFrame(3),
      { type: "caught_up", seq: 3 },
    ]);

    expect(sink.types).toEqual([
      "run_status",
      "node_status",
      "agent_event",
      "catchup_complete",
    ]);
  });

  it("watches the whole run for a viewer that has seen nothing", async () => {
    const { asked } = await joined([{ type: "caught_up", seq: 0 }]);

    expect(asked).toEqual([{ after: undefined }]);
  });

  it("asks the floor for what follows seq 3 when the viewer's cursor is 300", async () => {
    const { asked } = await joined([{ type: "caught_up", seq: 3 }], {
      after: "300",
    });

    expect(asked).toEqual([{ after: 3 }]);
  });

  it("does not resend agent event 300 to a viewer whose cursor is 300", async () => {
    const { sink } = await joined(
      [turnFrame(3), turnFrame(4), { type: "caught_up", seq: 4 }],
      { after: "300" },
    );

    expect(sink.agentIds).toEqual(["400"]);
  });

  it("stops watching run-1 when the viewer leaves", async () => {
    const { membership, stopped } = await joined([
      { type: "caught_up", seq: 0 },
    ]);

    membership.leave();

    expect(stopped).toEqual(["run-1"]);
  });

  it("ends the viewer as an error when the floor refuses the watch", async () => {
    const { sink } = await joined([], {
      end: { reason: "refused", code: 4429, detail: "too many viewers" },
    });

    expect(sink.ended).toBe("error");
  });

  it("drops a viewer that is 2 MB behind as slow and stops its watch", async () => {
    const { sink, stopped } = await joined([turnFrame(1)], {
      sink: new RecordingSink(2 * 1024 * 1024),
    });

    expect({ ended: sink.ended, stopped }).toEqual({
      ended: "slow",
      stopped: ["run-1"],
    });
  });
});
