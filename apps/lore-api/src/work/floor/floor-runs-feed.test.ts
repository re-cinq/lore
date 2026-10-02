import { describe, expect, it, vi } from "vitest";
import type { FloorFrame, FloorWatch, WatchEnd } from "@re-cinq/floor-client";
import type { RunListFrame } from "../assembly-line-station/protocol.js";
import { FloorRunsFeed, type RunsViewer } from "./floor-runs-feed.js";

function controllableWatch() {
  const queued: FloorFrame[] = [];
  let wake: (() => void) | null = null;
  let isStopped = false;
  let stops = 0;

  const watch: FloorWatch = {
    ended: Promise.resolve<WatchEnd>({ reason: "stopped" }),
    stop: () => {
      stops += 1;
      isStopped = true;
      wake?.();
    },
    async *[Symbol.asyncIterator]() {
      while (!isStopped) {
        const frame = queued.shift();
        if (frame) {
          yield frame;
        } else {
          await new Promise<void>((resolve) => (wake = resolve));
        }
      }
    },
  };

  return {
    watch,
    say: (frame: FloorFrame) => {
      queued.push(frame);
      wake?.();
    },
    stopCount: () => stops,
  };
}

function recordingViewer(): RunsViewer & {
  frames: RunListFrame[];
  ended: string | null;
} {
  const viewer = {
    frames: [] as RunListFrame[],
    ended: null as string | null,
    send: (frame: RunListFrame) => {
      viewer.frames.push(frame);
    },
    end: (reason: string) => {
      viewer.ended = reason;
    },
  };

  return viewer;
}

describe("FloorRunsFeed", () => {
  it("tells two viewers run-7 started through one floor watch", async () => {
    const floor = controllableWatch();
    let floorWatchesOpened = 0;
    const feed = new FloorRunsFeed({
      watchFloor: () => {
        floorWatchesOpened += 1;
        return floor.watch;
      },
      rowOf: async () => null,
    });
    const first = recordingViewer();
    const second = recordingViewer();
    feed.join(first);
    feed.join(second);

    floor.say({ type: "run_started", runId: "run-7" });
    await vi.waitFor(() => expect(first.frames).not.toEqual([]));

    expect({
      first: first.frames,
      second: second.frames,
      floorWatchesOpened,
    }).toEqual({
      first: [{ type: "run_started", run_id: "run-7" }],
      second: [{ type: "run_started", run_id: "run-7" }],
      floorWatchesOpened: 1,
    });
  });
});
