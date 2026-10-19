import { describe, it, expect } from "vitest";
import { InMemoryRunNotifier } from "./run-notify-hub.js";
import { memoryLiveTokens } from "./live-tokens.js";
import type { LiveServerMessage } from "./protocol.js";
import { MAX_SUBSCRIBERS_PER_RUN, RunFeedRegistry } from "./run-feed.js";
import { openRunChannel, type ChannelOutlet } from "./run-channel.js";
import {
  insertAgentEvents,
  readDeps,
  seedRun,
  type Seed,
} from "./run-stream-session.test.js";
import { RecordingSink } from "./frame-sink.js";

const flush = (): Promise<void> =>
  new Promise((resolve) => setImmediate(resolve));

function outlet(buffered = 0) {
  const sent: LiveServerMessage[] = [];
  const self: ChannelOutlet & {
    sent: LiveServerMessage[];
    endedCount: number;
  } = {
    sent,
    endedCount: 0,
    send: (message) => sent.push(message),
    bufferedBytes: () => buffered,
    ended: () => (self.endedCount += 1),
  };

  return self;
}

function deps(seed: Seed, over: { highWaterMark?: number } = {}) {
  const tokens = memoryLiveTokens();
  const notifier = new InMemoryRunNotifier();
  const feeds = new RunFeedRegistry({ ...readDeps(seed), notifier, ...over });

  return {
    tokens,
    notifier,
    feeds,
    channel: { verifyToken: tokens.verify, runs: seed.runs, feeds },
  };
}

const open = (subject: string, token: string, after?: string) =>
  ({
    type: "open",
    channel: "c1",
    kind: "run",
    subject,
    token,
    after,
  }) as const;

describe("openRunChannel", () => {
  it("says opened, then the snapshot and catchup_complete as frames, for a viewer holding this run's token", async () => {
    const seed = await seedRun();
    const d = deps(seed);
    const token = d.tokens.mint({
      kind: "run",
      subject: seed.run.id,
      user: { id: "ana", name: "Ana" },
    });
    const out = outlet();

    await insertAgentEvents(seed.events, 1);
    const handle = await openRunChannel(
      open(seed.run.id, token),
      out,
      d.channel,
    );

    await flush();

    expect(handle).not.toBeNull();
    expect(out.sent[0]).toEqual({ type: "opened", channel: "c1" });
    expect(
      out.sent.map((m) => (m.type === "frame" ? m.frame.type : m.type)),
    ).toEqual([
      "opened",
      "run_status",
      "node_status",
      "task_event",
      "task_event",
      "ci_check",
      "agent_event",
      "catchup_complete",
    ]);
  });

  it("replays from the cursor the open names", async () => {
    const seed = await seedRun();
    const d = deps(seed);
    const token = d.tokens.mint({
      kind: "run",
      subject: seed.run.id,
      user: { id: "ana", name: "Ana" },
    });
    const out = outlet();

    await insertAgentEvents(seed.events, 3);
    await openRunChannel(open(seed.run.id, token, "2"), out, d.channel);
    await flush();

    expect(
      out.sent.flatMap((m) =>
        m.type === "frame" && m.frame.type === "agent_event"
          ? [m.frame.event.id]
          : [],
      ),
    ).toEqual(["3"]);
  });

  it("closes as unauthorized for a token minted for another run, and as not_found for a run that is gone", async () => {
    const seed = await seedRun();
    const d = deps(seed);
    const other = d.tokens.mint({
      kind: "run",
      subject: "other-run",
      user: { id: "ana", name: "Ana" },
    });
    const missing = d.tokens.mint({
      kind: "run",
      subject: "nope",
      user: { id: "ana", name: "Ana" },
    });
    const first = outlet();
    const second = outlet();

    const handles = [
      await openRunChannel(open(seed.run.id, other), first, d.channel),
      await openRunChannel(open("nope", missing), second, d.channel),
    ];

    expect({
      handles,
      first: first.sent,
      second: second.sent,
      feeds: d.feeds.feedCount,
    }).toEqual({
      handles: [null, null],
      first: [{ type: "closed", channel: "c1", reason: "unauthorized" }],
      second: [{ type: "closed", channel: "c1", reason: "not_found" }],
      feeds: 0,
    });
  });

  it("closes as capacity once the run has its maximum viewers", async () => {
    const seed = await seedRun();
    const d = deps(seed);
    const token = d.tokens.mint({
      kind: "run",
      subject: seed.run.id,
      user: { id: "ana", name: "Ana" },
    });

    for (let i = 0; i < MAX_SUBSCRIBERS_PER_RUN; i++) {
      d.feeds.join(seed.run, new RecordingSink(), "0");
    }
    const out = outlet();

    expect(
      await openRunChannel(open(seed.run.id, token), out, d.channel),
    ).toBeNull();
    expect(out.sent).toEqual([
      { type: "closed", channel: "c1", reason: "capacity" },
    ]);
  });

  it("closes as slow and tells the socket it ended when the wire falls behind", async () => {
    const seed = await seedRun();
    const d = deps(seed, { highWaterMark: 8 });
    const token = d.tokens.mint({
      kind: "run",
      subject: seed.run.id,
      user: { id: "ana", name: "Ana" },
    });
    const out = outlet(9);

    await openRunChannel(open(seed.run.id, token), out, d.channel);
    await flush();

    expect(out.sent.at(-1)).toEqual({
      type: "closed",
      channel: "c1",
      reason: "slow",
    });
    expect(out.endedCount).toBe(1);
    expect(d.feeds.feedCount).toBe(0);
  });

  it("leaves the feed when the socket closes the channel", async () => {
    const seed = await seedRun();
    const d = deps(seed);
    const token = d.tokens.mint({
      kind: "run",
      subject: seed.run.id,
      user: { id: "ana", name: "Ana" },
    });
    const handle = await openRunChannel(
      open(seed.run.id, token),
      outlet(),
      d.channel,
    );

    await flush();
    handle?.close();

    expect(d.feeds.feedCount).toBe(0);
    expect(d.notifier.subscriberCount).toBe(0);
  });
});
