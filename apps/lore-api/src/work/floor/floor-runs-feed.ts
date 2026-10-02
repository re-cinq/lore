// The live run list's one ear on the floor: a single floor-wide watch, opened for the first viewer and stopped when the last leaves, fanned out to every browser looking at the list. The floor says only which run started or changed; a changed run is read once, as the row the list shows, and sent to the viewers that have it on their page.
import type { FloorFrame, FloorWatch } from "@re-cinq/floor-client";
import type { EndReason } from "../assembly-line-station/frame-sink.js";
import type { RunListFrame } from "../assembly-line-station/protocol.js";
import type { FloorRunRow } from "./floor-run-rows.js";

export interface RunsViewer {
  send(frame: RunListFrame): void;
  end(reason: EndReason): void;
}

export interface RunsMembership {
  /** Replaces the runs this viewer hears changes of; a run newly on its page is sent as a row at once, which closes the gap between the page it read and this subscription. */
  watch(runIds: readonly string[]): void;
  leave(): void;
}

export interface FloorRunsFeedDeps {
  watchFloor: () => FloorWatch;
  rowOf: (runId: string) => Promise<FloorRunRow | null>;
}

export class FloorRunsFeed {
  private readonly watched = new Map<RunsViewer, Set<string>>();
  private readonly reads = new Map<string, "reading" | "dirty">();
  private floorWatch: FloorWatch | null = null;

  constructor(private readonly deps: FloorRunsFeedDeps) {}

  join(viewer: RunsViewer): RunsMembership {
    this.watched.set(viewer, new Set());
    this.openFloorWatch();

    return {
      watch: (runIds) => this.replaceWatched(viewer, runIds),
      leave: () => this.leave(viewer),
    };
  }

  private openFloorWatch(): void {
    if (this.floorWatch) {
      return;
    }
    this.floorWatch = this.deps.watchFloor();
    void this.follow(this.floorWatch);
  }

  private leave(viewer: RunsViewer): void {
    this.watched.delete(viewer);

    if (this.watched.size > 0) {
      return;
    }
    this.floorWatch?.stop();
    this.floorWatch = null;
  }

  private async follow(watch: FloorWatch): Promise<void> {
    try {
      for await (const frame of watch) {
        this.dispatch(frame);
      }
    } catch (err) {
      console.warn(`[floor] runs watch failed: ${String(err)}`);
    }
    this.refused(watch);
  }

  /** An iterator that ends while this watch is still the feed's own was refused by the floor, not stopped by the last viewer leaving. */
  private refused(watch: FloorWatch): void {
    if (this.floorWatch !== watch) {
      return;
    }
    this.floorWatch = null;
    const stranded = [...this.watched.keys()];

    this.watched.clear();
    stranded.forEach((viewer) => viewer.end("error"));
  }

  private dispatch(frame: FloorFrame): void {
    if (frame.type === "run_changed") {
      this.refresh(frame.runId);

      return;
    }
    this.broadcast(
      frame.type === "run_started"
        ? { type: "run_started", run_id: frame.runId }
        : { type: "resync" },
    );
  }

  private broadcast(frame: RunListFrame): void {
    this.watched.forEach((_runIds, viewer) => viewer.send(frame));
  }

  private refresh(runId: string): void {
    if (![...this.watched.values()].some((ids) => ids.has(runId))) {
      return;
    }

    if (this.reads.has(runId)) {
      this.reads.set(runId, "dirty");

      return;
    }
    void this.readUntilSettled(runId);
  }

  /** One read in flight per run; changes that land meanwhile cost exactly one more, so the last state wins. */
  private async readUntilSettled(runId: string): Promise<void> {
    do {
      this.reads.set(runId, "reading");
      const row = await this.readRow(runId);

      this.watched.forEach((ids, viewer) => {
        if (row && ids.has(runId)) {
          viewer.send({ type: "run_row", run: row });
        }
      });
    } while (this.reads.get(runId) === "dirty");
    this.reads.delete(runId);
  }

  private replaceWatched(viewer: RunsViewer, runIds: readonly string[]): void {
    const previous = this.watched.get(viewer);

    if (!previous) {
      return;
    }
    const added = runIds.filter((runId) => !previous.has(runId));

    this.watched.set(viewer, new Set(runIds));
    added.forEach((runId) => void this.sendRowTo(viewer, runId));
  }

  private async sendRowTo(viewer: RunsViewer, runId: string): Promise<void> {
    const row = await this.readRow(runId);

    if (row && this.watched.get(viewer)?.has(runId)) {
      viewer.send({ type: "run_row", run: row });
    }
  }

  private async readRow(runId: string): Promise<FloorRunRow | null> {
    try {
      return await this.deps.rowOf(runId);
    } catch (err) {
      console.warn(`[floor] run row unavailable: ${runId}: ${String(err)}`);

      return null;
    }
  }
}
