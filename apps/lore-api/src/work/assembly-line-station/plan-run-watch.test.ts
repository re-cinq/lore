import { describe, expect, it, vi } from "vitest";
import type { AssemblyRunRecord } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-port.js";
import type { RunsViewer } from "../floor/floor-runs-feed.js";
import { PlanRunWatch, type PlanRunListener } from "./plan-run-watch.js";

const runOf = (id: string, subjectKey: string | null) =>
  ({ id, subjectKey }) as AssemblyRunRecord;

function listener() {
  return {
    started: vi.fn<PlanRunListener["started"]>(),
    resync: vi.fn<PlanRunListener["resync"]>(),
    lost: vi.fn<PlanRunListener["lost"]>(),
  };
}

function setup(runs: Record<string, AssemblyRunRecord | Error>) {
  const feed = fakeFeed();
  const getById = vi.fn(async (id: string) => {
    const found = runs[id];

    if (found instanceof Error) {
      throw found;
    }

    return found ?? null;
  });
  const watch = new PlanRunWatch({ feed, runs: { getById }, log: () => {} });

  return { feed, getById, watch };
}

function fakeFeed() {
  const viewers: RunsViewer[] = [];
  const left: RunsViewer[] = [];

  return {
    viewers,
    left,
    join(viewer: RunsViewer) {
      viewers.push(viewer);

      return { watch: () => {}, leave: () => left.push(viewer) };
    },
  };
}

const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("PlanRunWatch", () => {
  it("reads run-9 once for two channels on plan p1 and tells both, and not the channel on plan p2", async () => {
    const run = runOf("run-9", "plan_id:p1");
    const s = setup({ "run-9": run });
    const [a, b, other] = [listener(), listener(), listener()];

    s.watch.follow("p1", a);
    s.watch.follow("p1", b);
    s.watch.follow("p2", other);
    s.feed.viewers[0].send({ type: "run_started", run_id: "run-9" });
    await settled();

    expect({
      reads: s.getById.mock.calls.length,
      toldA: a.started.mock.calls,
      toldB: b.started.mock.calls,
      toldOther: other.started.mock.calls,
    }).toEqual({ reads: 1, toldA: [[run]], toldB: [[run]], toldOther: [] });
  });

  it("tells no channel of a code-review run that started", async () => {
    const s = setup({ "run-3": runOf("run-3", "pr:7") });
    const a = listener();

    s.watch.follow("p1", a);
    s.feed.viewers[0].send({ type: "run_started", run_id: "run-3" });
    await settled();

    expect(a.started).not.toHaveBeenCalled();
  });

  it("joins the floor's feed once for every channel, and leaves it when the last one stops", () => {
    const s = setup({});
    const stopA = s.watch.follow("p1", listener());
    const stopB = s.watch.follow("p2", listener());

    stopA();
    const afterOne = {
      joined: s.feed.viewers.length,
      left: s.feed.left.length,
    };

    stopB();

    expect({
      afterOne,
      afterBoth: { left: s.feed.left.length, plans: s.watch.planCount },
    }).toEqual({
      afterOne: { joined: 1, left: 0 },
      afterBoth: { left: 1, plans: 0 },
    });
  });

  it("passes a resync to every channel", () => {
    const s = setup({});
    const [a, b] = [listener(), listener()];

    s.watch.follow("p1", a);
    s.watch.follow("p2", b);
    s.feed.viewers[0].send({ type: "resync" });

    expect([a.resync.mock.calls.length, b.resync.mock.calls.length]).toEqual([
      1, 1,
    ]);
  });

  it("asks every channel to resync when a started run can't be read", async () => {
    const s = setup({ "run-9": new Error("floor unreachable") });
    const a = listener();

    s.watch.follow("p1", a);
    s.feed.viewers[0].send({ type: "run_started", run_id: "run-9" });
    await settled();

    expect(a.resync).toHaveBeenCalledTimes(1);
  });

  it("tells every channel the feed is lost when it ends, and joins afresh for the next channel", () => {
    const s = setup({});
    const a = listener();

    s.watch.follow("p1", a);
    s.feed.viewers[0].end("error");
    s.watch.follow("p1", listener());

    expect(a.lost).toHaveBeenCalledTimes(1);
    expect(s.feed.viewers).toHaveLength(2);
  });
});
