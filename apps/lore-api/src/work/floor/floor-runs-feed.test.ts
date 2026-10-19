import { describe, expect, it } from "vitest";
import type { FloorRunRow } from "./floor-run-rows.js";
import { FloorRunsFeed } from "./floor-runs-feed.js";
import {
  controllableWatch,
  feedOverFreshFloors,
  feedOverRows,
  recordingViewer,
  row,
  until,
} from "./floor-runs-feed.fixtures.js";

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
    await until(() => first.frames.length > 0);

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

  it("sends run-1's row to its watcher and nothing to a bystander when run-1 changes", async () => {
    const { feed, floor, asked } = feedOverRows();
    const watcher = recordingViewer();
    const bystander = recordingViewer();

    feed.join(watcher).watch(["run-1"]);
    feed.join(bystander).watch([]);
    await until(() => watcher.frames.length === 1);

    floor.say({ type: "run_changed", runId: "run-1" });
    await until(() => watcher.frames.length === 2);

    expect({
      watcher: watcher.frames,
      bystander: bystander.frames,
      asked,
    }).toEqual({
      watcher: [
        { type: "run_row", run: row() },
        { type: "run_row", run: row() },
      ],
      bystander: [],
      asked: ["run-1", "run-1"],
    });
  });

  it("reads no row when run-9 changes and nobody watches it", async () => {
    const { feed, floor, asked } = feedOverRows();
    const viewer = recordingViewer();

    feed.join(viewer).watch([]);

    floor.say({ type: "run_changed", runId: "run-9" });
    floor.say({ type: "run_started", runId: "run-7" });
    await until(() => viewer.frames.length === 1);

    expect(asked).toEqual([]);
  });

  it("sends a row per newly watched run: run-1 and run-2, then only run-3 on a second watch of run-2 and run-3", async () => {
    const { feed } = feedOverRows();
    const viewer = recordingViewer();
    const membership = feed.join(viewer);
    const rowIds = () =>
      viewer.frames.flatMap((frame) =>
        frame.type === "run_row" ? [frame.run.id] : [],
      );

    membership.watch(["run-1", "run-2"]);
    await until(() => rowIds().length === 2);
    const firstBatch = rowIds().sort();

    membership.watch(["run-2", "run-3"]);
    await until(() => rowIds().length === 3);

    expect({ firstBatch, secondBatch: rowIds().slice(2) }).toEqual({
      firstBatch: ["run-1", "run-2"],
      secondBatch: ["run-3"],
    });
  });

  it("sends nothing when run-1 changes after its viewer swapped to watching run-2", async () => {
    const { feed, floor } = feedOverRows();
    const viewer = recordingViewer();
    const membership = feed.join(viewer);

    membership.watch(["run-1"]);
    await until(() => viewer.frames.length === 1);
    membership.watch(["run-2"]);
    await until(() => viewer.frames.length === 2);

    floor.say({ type: "run_changed", runId: "run-1" });
    floor.say({ type: "run_started", runId: "run-7" });
    await until(() => viewer.frames.length === 3);

    expect(viewer.frames).toEqual([
      { type: "run_row", run: row({ id: "run-1" }) },
      { type: "run_row", run: row({ id: "run-2" }) },
      { type: "run_started", run_id: "run-7" },
    ]);
  });

  it("tells every viewer to resync when the floor says resync", async () => {
    const { feed, floor } = feedOverRows();
    const first = recordingViewer();
    const second = recordingViewer();

    feed.join(first);
    feed.join(second);

    floor.say({ type: "resync" });
    await until(() => second.frames.length > 0);

    expect({ first: first.frames, second: second.frames }).toEqual({
      first: [{ type: "resync" }],
      second: [{ type: "resync" }],
    });
  });

  it("stops the floor watch only when the last of two viewers leaves, and opens a second one for a later viewer", () => {
    const { feed, floors } = feedOverFreshFloors();
    const first = feed.join(recordingViewer());
    const second = feed.join(recordingViewer());

    first.leave();
    const afterFirst = floors[0]?.stopCount();

    second.leave();
    const afterSecond = floors[0]?.stopCount();

    feed.join(recordingViewer());

    expect({
      afterFirst,
      afterSecond,
      floorWatchesOpened: floors.length,
    }).toEqual({
      afterFirst: 0,
      afterSecond: 1,
      floorWatchesOpened: 2,
    });
  });

  it("costs two reads for three changes of run-1 mid-read and sends the last row read last", async () => {
    const floor = controllableWatch();
    const asked: string[] = [];
    const answers: ((found: FloorRunRow) => void)[] = [];
    const feed = new FloorRunsFeed({
      watchFloor: () => floor.watch,
      rowOf: (runId) => {
        asked.push(runId);

        return new Promise((resolve) => answers.push(resolve));
      },
    });
    const viewer = recordingViewer();

    feed.join(viewer).watch(["run-1"]);
    await until(() => asked.length === 1);
    answers[0]?.(row());
    await until(() => viewer.frames.length === 1);

    floor.say({ type: "run_changed", runId: "run-1" });
    floor.say({ type: "run_changed", runId: "run-1" });
    floor.say({ type: "run_changed", runId: "run-1" });
    floor.say({ type: "run_started", runId: "run-7" });
    await until(() => viewer.frames.length === 2);
    answers[1]?.(row({ status: "queued" }));
    await until(() => asked.length === 3);
    answers[2]?.(row({ status: "succeeded" }));
    await until(() => viewer.frames.length === 4);

    expect({
      readsForChanges: asked.length - 1,
      lastSent: viewer.frames.at(-1),
    }).toEqual({
      readsForChanges: 2,
      lastSent: { type: "run_row", run: row({ status: "succeeded" }) },
    });
  });

  it("ends a viewer with error when the floor watch ends under it, and opens a new floor watch for the next viewer", async () => {
    const { feed, floors } = feedOverFreshFloors();
    const stranded = recordingViewer();

    feed.join(stranded);

    floors[0]?.endNow();
    await until(() => stranded.ended !== null);
    feed.join(recordingViewer());

    expect({
      ended: stranded.ended,
      floorWatchesOpened: floors.length,
    }).toEqual({
      ended: "error",
      floorWatchesOpened: 2,
    });
  });

  it("sends nothing for a rejected read of run-1 and sends the row of its next change", async () => {
    const floor = controllableWatch();
    const reads = [
      () => Promise.reject(new Error("floor unreachable")),
      () => Promise.resolve(row()),
    ];
    const asked: string[] = [];
    const feed = new FloorRunsFeed({
      watchFloor: () => floor.watch,
      rowOf: () => {
        asked.push("run-1");

        return reads[asked.length - 1]?.() ?? Promise.resolve(null);
      },
    });
    const viewer = recordingViewer();

    feed.join(viewer).watch(["run-1"]);
    await until(() => asked.length === 1);
    const afterRejection = [...viewer.frames];

    floor.say({ type: "run_changed", runId: "run-1" });
    await until(() => viewer.frames.length > 0);

    expect({ afterRejection, afterChange: viewer.frames }).toEqual({
      afterRejection: [],
      afterChange: [{ type: "run_row", run: row() }],
    });
  });
});
