import { describe, expect, it } from "vitest";
import type { AssemblyRunRecord } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-port.js";
import { InMemoryAssemblyRuns } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-memory.js";
import type { FrameSink } from "./frame-sink.js";
import { memoryLiveTokens } from "./live-tokens.js";
import {
  openPlanRunChannel,
  type PlanRunChannelDeps,
} from "./plan-run-channel.js";
import type { PlanRunListener } from "./plan-run-watch.js";
import type { LiveServerMessage } from "./protocol.js";
import type { ChannelOutlet } from "./run-channel.js";
import type { RunStreamFrame } from "./run-stream-frame.js";

const ANA = { id: "ana", name: "Ana" };

function recordingOutlet() {
  const sent: LiveServerMessage[] = [];
  const counts = { ended: 0 };
  const outlet: ChannelOutlet = {
    send: (message) => sent.push(message),
    bufferedBytes: () => 0,
    ended: () => {
      counts.ended += 1;
    },
  };

  return { sent, outlet, counts };
}

async function setup(over: Partial<PlanRunChannelDeps> = {}) {
  const runs = new InMemoryAssemblyRuns();
  const tokens = memoryLiveTokens();
  const feeds = fakeFeeds();
  const watch = fakeWatch();
  const listed: string[] = [];
  const prReads: number[] = [];
  const deps: PlanRunChannelDeps = {
    verifyToken: tokens.verify,
    planExists: async (planId) => planId === "p1",
    planRuns: async () => planRunsOf(runs, [...listed].reverse()),
    runs,
    prStatus: async (_repo, prNumber) => {
      prReads.push(prNumber);

      return { title: `Spec PR ${prNumber}`, unresolved_threads: 1 };
    },
    feeds,
    watch,
    refreshMs: 0,
    ...over,
  };
  const start = async (args: Record<string, unknown> = {}) => {
    const id = await runs.start({
      blueprintName: "feature-planning",
      repo: "o/r",
      args,
    });

    listed.push(id);

    return id;
  };
  const open = async (planId = "p1", token?: string) => {
    const { sent, outlet, counts } = recordingOutlet();
    const handle = await openPlanRunChannel(
      {
        type: "open",
        channel: "c",
        kind: "plan-run",
        subject: planId,
        token:
          token ??
          tokens.mint({ kind: "plan-run", subject: planId, user: ANA }),
      },
      outlet,
      deps,
    );

    return { sent, counts, handle };
  };

  return { runs, tokens, feeds, watch, prReads, start, open, deps };
}

function fakeFeeds() {
  const joined: { runId: string; sink: FrameSink; left: boolean }[] = [];

  return {
    joined,
    join(run: AssemblyRunRecord, sink: FrameSink) {
      const entry = { runId: run.id, sink, left: false };

      joined.push(entry);

      return { ready: Promise.resolve(), leave: () => (entry.left = true) };
    },
  };
}

function fakeWatch() {
  const listeners: PlanRunListener[] = [];

  return {
    listeners,
    follow(_planId: string, listener: PlanRunListener) {
      listeners.push(listener);

      return () => listeners.splice(listeners.indexOf(listener), 1);
    },
  };
}

async function planRunsOf(runs: InMemoryAssemblyRuns, ids: string[]) {
  const found = await Promise.all(ids.map((id) => runs.getById(id)));

  return found.filter((run): run is AssemblyRunRecord => run !== null);
}

const settled = () => new Promise((resolve) => setTimeout(resolve, 10));

async function burst(sink: FrameSink, frames: RunStreamFrame[]) {
  frames.forEach((frame) => sink.send(frame));
  await settled();
}

const typesOf = (sent: LiveServerMessage[]) =>
  sent.map((message) =>
    message.type === "frame" ? `frame:${message.frame.type}` : message.type,
  );

const node = (outcome: string | null): RunStreamFrame =>
  ({
    type: "node_status",
    node: { node_id: "analyze", outcome },
  }) as unknown as RunStreamFrame;

describe("openPlanRunChannel", () => {
  it("closes with unauthorized for a token minted for plan p2, joining no feed", async () => {
    const s = await setup();
    const token = s.tokens.mint({ kind: "plan-run", subject: "p2", user: ANA });
    const { sent, handle } = await s.open("p1", token);

    expect(handle).toBeNull();
    expect(sent).toEqual([
      { type: "closed", channel: "c", reason: "unauthorized" },
    ]);
    expect(s.feeds.joined).toEqual([]);
  });

  it("closes with not_found for a plan that is gone", async () => {
    const s = await setup();
    const { sent, handle } = await s.open("gone");

    expect(handle).toBeNull();
    expect(sent).toEqual([
      { type: "closed", channel: "c", reason: "not_found" },
    ]);
  });

  it("sends a null plan_run for a plan no run has started for, and joins no feed", async () => {
    const s = await setup();
    const { sent, handle } = await s.open();

    expect(handle).not.toBeNull();
    expect(sent).toEqual([
      { type: "opened", channel: "c" },
      { type: "plan_run", channel: "c", run: null },
    ]);
    expect(s.feeds.joined).toEqual([]);
  });

  it("throws when the plan's runs can't be read, sending no null plan_run in place of the failure", async () => {
    const s = await setup({
      planRuns: async () => {
        throw new Error("floor unreachable");
      },
    });
    const { outlet, sent } = recordingOutlet();

    await expect(
      openPlanRunChannel(
        {
          type: "open",
          channel: "c",
          kind: "plan-run",
          subject: "p1",
          token: s.tokens.mint({ kind: "plan-run", subject: "p1", user: ANA }),
        },
        outlet,
        s.deps,
      ),
    ).rejects.toThrow("floor unreachable");
    expect(sent).toEqual([]);
  });

  it("sends run-2's facts with spec PR #7's title and threads, then joins run-2's feed", async () => {
    const s = await setup();
    const runId = await s.start({ pr_number: 7, story_issue: "4" });
    const { sent } = await s.open();

    expect(sent).toMatchObject([
      { type: "opened" },
      {
        type: "plan_run",
        run: {
          id: runId,
          status: "queued",
          pr_number: 7,
          pr_url: "https://github.com/o/r/pull/7",
          pr_title: "Spec PR 7",
          pr_unresolved_threads: 1,
          issue_number: 4,
          issue_url: "https://github.com/o/r/issues/4",
        },
      },
    ]);
    expect(s.feeds.joined.map((entry) => entry.runId)).toEqual([runId]);
  });

  it("forwards the feed's run_status and node_status but no agent_event and no ci_check", async () => {
    const s = await setup();

    await s.start();
    const channel = await s.open();

    [
      { type: "run_status", run: { id: "x" } } as RunStreamFrame,
      node(null),
      { type: "agent_event", event: { id: "1" } } as RunStreamFrame,
      { type: "ci_check", check: {} } as RunStreamFrame,
      { type: "catchup_complete", last_id: "1" } as RunStreamFrame,
    ].forEach((frame) => s.feeds.joined[0].sink.send(frame));

    expect(typesOf(channel.sent).slice(2)).toEqual([
      "frame:run_status",
      "frame:node_status",
      "frame:catchup_complete",
    ]);
  });

  it("re-reads the facts once for a burst of two settling visits after catch-up, and sends plan_run only when they changed", async () => {
    const s = await setup();
    const runId = await s.start({ pr_number: 7 });
    const channel = await s.open();
    const { sink } = s.feeds.joined[0];

    sink.send({ type: "catchup_complete", last_id: "0" });
    await s.runs.markRunning(runId);
    await burst(sink, [node("success"), node("success")]);
    await burst(sink, [node("success")]);

    expect({
      prReads: s.prReads,
      statuses: channel.sent.flatMap((m) =>
        m.type === "plan_run" ? [m.run?.status] : [],
      ),
    }).toEqual({ prReads: [7, 7, 7], statuses: ["queued", "running"] });
  });

  it("does not re-read the facts for the visits the feed's snapshot replays before catch-up", async () => {
    const s = await setup();

    await s.start({ pr_number: 7 });
    await s.open();
    s.feeds.joined[0].sink.send(node("success"));
    await settled();

    expect(s.prReads).toEqual([7]);
  });

  it("switches to run-2 when it starts: leaves run-1's feed, sends run-2's facts, joins its feed, and drops a late frame of run-1", async () => {
    const s = await setup();
    const first = await s.start();
    const { sent } = await s.open();
    const second = await s.start();

    s.watch.listeners[0].started((await s.runs.getById(second))!);
    await settled();
    s.feeds.joined[0].sink.send(node(null));

    expect(s.feeds.joined.map(({ runId, left }) => ({ runId, left }))).toEqual([
      { runId: first, left: true },
      { runId: second, left: false },
    ]);
    expect(typesOf(sent)).toEqual(["opened", "plan_run", "plan_run"]);
    expect(sent.at(-1)).toMatchObject({ run: { id: second } });
  });

  it("asks for the plan's runs again on a resync and moves to the run it now picks", async () => {
    const s = await setup();

    await s.start();
    await s.open();
    const second = await s.start();

    s.watch.listeners[0].resync();
    await settled();

    expect(s.feeds.joined.at(-1)?.runId).toBe(second);
  });

  it("joins run-2's feed once when its start arrives after a resync already moved there", async () => {
    const s = await setup();
    const first = await s.start();

    await s.open();
    const second = await s.start();

    s.watch.listeners[0].resync();
    s.watch.listeners[0].started((await s.runs.getById(second))!);
    await settled();

    expect(s.feeds.joined.map(({ runId, left }) => ({ runId, left }))).toEqual([
      { runId: first, left: true },
      { runId: second, left: false },
    ]);
  });

  it("drops run-1's pending re-read when the channel switches to run-2", async () => {
    const s = await setup({ refreshMs: 30 });

    await s.start({ pr_number: 7 });
    await s.open();
    const second = await s.start({ pr_number: 8 });
    const { sink } = s.feeds.joined[0];

    sink.send({ type: "catchup_complete", last_id: "0" });
    sink.send(node("success"));
    s.watch.listeners[0].started((await s.runs.getById(second))!);
    await new Promise((resolve) => setTimeout(resolve, 60));

    expect(s.prReads).toEqual([7, 8]);
  });

  it("closes with server when the floor's feed of starts is lost, and stops watching", async () => {
    const s = await setup();

    await s.start();
    const { sent, counts } = await s.open();

    s.watch.listeners[0].lost();

    expect({
      last: sent.at(-1),
      ended: counts.ended,
      watching: s.watch.listeners.length,
      leftFeed: s.feeds.joined[0].left,
    }).toEqual({
      last: { type: "closed", channel: "c", reason: "server" },
      ended: 1,
      watching: 0,
      leftFeed: true,
    });
  });

  it("closes with capacity when the run's feed is full", async () => {
    const s = await setup({
      feeds: {
        join: () => {
          throw new Error("run stream: run-1 already has 20 subscribers");
        },
      },
    });

    await s.start();
    const { sent, handle } = await s.open();

    expect(handle).toBeNull();
    expect(sent.at(-1)).toEqual({
      type: "closed",
      channel: "c",
      reason: "capacity",
    });
  });

  it("leaves the feed and stops watching when the client closes the channel", async () => {
    const s = await setup();

    await s.start();
    const { handle } = await s.open();

    handle?.close();

    expect(s.feeds.joined[0].left).toBe(true);
    expect(s.watch.listeners).toEqual([]);
  });
});
