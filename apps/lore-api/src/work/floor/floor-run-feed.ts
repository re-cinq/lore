// One viewer of a floor run: the run's snapshot, then the floor's own journal relayed from the viewer's cursor until it leaves. The floor already multiplexes its viewers, so each one here is one socket there, opened on join and closed on leave.
import type { FloorClient, RunWatch, WatchEnd } from "@re-cinq/floor-client";
import type { AssemblyRunRecord } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-port.js";
import type { FrameSink } from "../assembly-line-station/frame-sink.js";
import type { Membership } from "../assembly-line-station/run-feed.js";
import {
  nodeStatusFrame,
  runStatusFrame,
  type RunStreamFrame,
} from "../assembly-line-station/run-stream-frame.js";
import type { FloorRunReads } from "./floor-backed-runs.js";
import { floorFrames } from "./floor-frames.js";
import { floorCursorOf } from "./floor-run-mapping.js";

const HIGH_WATER_MARK = 1024 * 1024;

export interface FloorRunFeedDeps {
  watch: FloorClient["runs"]["watch"];
  runs: Pick<FloorRunReads, "listStationRuns">;
  highWaterMark?: number;
}

export class FloorRunFeeds {
  constructor(private readonly deps: FloorRunFeedDeps) {}

  join(run: AssemblyRunRecord, sink: FrameSink, after: string): Membership {
    const watch = this.deps.watch(run.id, { after: floorCursorOf(after) });
    const viewer = new FloorViewer(run, sink, after, this.highWaterMark());

    return {
      ready: this.relay(run, watch, viewer),
      leave: () => watch.stop(),
    };
  }

  private highWaterMark(): number {
    return this.deps.highWaterMark ?? HIGH_WATER_MARK;
  }

  /** Settles once the viewer has the snapshot and the replay; the live frames keep flowing behind it. */
  private async relay(
    run: AssemblyRunRecord,
    watch: RunWatch,
    viewer: FloorViewer,
  ): Promise<void> {
    const visits = await this.deps.runs.listStationRuns(run.id);

    viewer.send([runStatusFrame(run), ...visits.map(nodeStatusFrame)]);

    return new Promise<void>((caughtUp) => {
      follow(watch, viewer, caughtUp).catch(() => {
        viewer.fail();
        caughtUp();
      });
    });
  }
}

async function follow(
  watch: RunWatch,
  viewer: FloorViewer,
  caughtUp: () => void,
): Promise<void> {
  for await (const frame of watch) {
    viewer.send(floorFrames(frame, viewer.run));

    if (frame.type === "caught_up") {
      caughtUp();
    }

    if (viewer.behind()) {
      viewer.drop();
      watch.stop();
    }
  }
  caughtUp();
  viewer.heardEnd(await watch.ended);
}

/** What one viewer has been sent. A reconnect replays whole turns, so a row at or below the viewer's cursor is one it already has. */
class FloorViewer {
  constructor(
    readonly run: AssemblyRunRecord,
    private readonly sink: FrameSink,
    private readonly cursor: string,
    private readonly highWaterMark: number,
  ) {}

  send(frames: RunStreamFrame[]): void {
    frames
      .filter((frame) => this.unseen(frame))
      .forEach((frame) => this.sink.send(frame));
  }

  behind(): boolean {
    return this.sink.bufferedBytes() > this.highWaterMark;
  }

  drop(): void {
    this.sink.end("slow");
  }

  fail(): void {
    this.sink.end("error");
  }

  /** A refusal is the floor saying no: a bad cursor, no such run, too many viewers. A settled or stopped watch just ended. */
  heardEnd(ended: WatchEnd): void {
    if (ended.reason === "refused") {
      this.fail();
    }
  }

  private unseen(frame: RunStreamFrame): boolean {
    return (
      frame.type !== "agent_event" ||
      BigInt(frame.event.id) > BigInt(this.cursor)
    );
  }
}
