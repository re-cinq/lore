// One feed per assembly run (specs/assembly-line-run-viz FR7.4–FR7.6): the first viewer opens it, it listens ONCE for the run's pod events and transcript messages, re-reads what a notification names ONCE, and forwards the frame to every viewer registered for that run. A joining viewer catches up from its own cursor first; the last one to leave closes the feed.

import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import type { AssemblyRunRecord } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-port.js";
import type { AgentRunEvent } from "@re-cinq/lore-shared/models/agent-run-event.js";
import type { EndReason, FrameSink } from "./frame-sink.js";
import { agentEventFrame, type RunStreamFrame } from "./run-stream-frame.js";
import type {
  NotificationKind,
  RunNotification,
  RunNotifier,
} from "./run-notify-hub.js";
import {
  catchUp,
  notifyFilterFor,
  readCiCheck,
  readNode,
  readRunStatus,
  readTaskEvent,
  type RunReadDeps,
  type Subscriber,
} from "./run-stream-session.js";

/** Defensive cap: one run's page should need a handful of viewers, not hundreds of leaked registrations. */
export const MAX_SUBSCRIBERS_PER_RUN = 20;

/** Buffered bytes past which a viewer counts as too slow to keep. */
const HIGH_WATER_MARK = 1024 * 1024;

const PAGE_SIZE = 1000;

export interface RunFeedDeps extends RunReadDeps {
  notifier: RunNotifier;
  highWaterMark?: number;
}

export interface Membership {
  /** Settles once this viewer's snapshot and replay have been delivered. */
  ready: Promise<void>;
  /** The viewer is gone; the feed closes once nobody is left. Idempotent. */
  leave(): void;
}

const later = (frame: RunStreamFrame, cursor: string): boolean =>
  frame.type !== "agent_event" || BigInt(frame.event.id) > BigInt(cursor);

/** One registered viewer: its sink, its own agent-event cursor, and the drop when it falls behind. */
class Member implements Subscriber {
  private position: string;
  private gone = false;

  constructor(
    private readonly sink: FrameSink,
    after: string,
    private readonly highWaterMark: number,
    private readonly onGone: (member: Member) => void,
  ) {
    this.position = after;
  }

  cursor(): string {
    return this.position;
  }

  closed(): boolean {
    return this.gone;
  }

  /** Delivers a frame this viewer has not seen; a replayed agent event at or below its cursor is skipped. */
  emit(frame: RunStreamFrame): void {
    if (this.gone || !later(frame, this.position)) {
      return;
    }

    if (frame.type === "agent_event") {
      this.position = frame.event.id;
    }
    this.sink.send(frame);

    if (this.sink.bufferedBytes() > this.highWaterMark) {
      this.end("slow");
    }
  }

  end(reason: EndReason): void {
    if (this.gone) {
      return;
    }
    this.gone = true;
    this.sink.end(reason);
    this.onGone(this);
  }

  leave(): void {
    if (this.gone) {
      return;
    }
    this.gone = true;
    this.onGone(this);
  }
}

type LiveRead = (
  feed: RunFeed,
  notification: RunNotification,
) => Promise<RunStreamFrame | null>;

const LIVE_READS: Record<NotificationKind, LiveRead> = {
  agent_event: (feed) => feed.forwardNewAgentEvents(),
  node_status: (feed, n) => readNode(feed.deps, feed.run, n.row),
  run_status: (feed) => readRunStatus(feed.deps, feed.run),
  task_event: (feed, n) => readTaskEvent(feed.deps, feed.run, n.id),
  ci_check: (feed) => feed.readCi(),
};

/** The run's listener and its viewers. Every read runs on one chain, so a viewer's catch-up never interleaves with a live re-read and a frame never reaches a viewer out of order. */
class RunFeed {
  private readonly members = new Set<Member>();
  /** The newest agent event forwarded live; a live drain starts here. */
  private cursor = "0";
  private chain: Promise<void> = Promise.resolve();
  private ciReadQueued = false;
  private unsubscribe: () => void = () => {};
  private closed = false;

  constructor(
    readonly run: AssemblyRunRecord,
    readonly deps: RunFeedDeps,
    private readonly onEmpty: () => void,
  ) {}

  /** Subscribes before any viewer catches up, so nothing lands in the gap (FR2.3). */
  start(): void {
    this.unsubscribe = this.deps.notifier.subscribe(
      notifyFilterFor(this.run),
      (notification) => this.enqueueLive(notification),
      () => void this.enqueue(() => this.resync()),
    );
  }

  get size(): number {
    return this.members.size;
  }

  join(sink: FrameSink, after: string): Membership {
    enforceTrue(
      this.members.size < MAX_SUBSCRIBERS_PER_RUN,
      Error,
      `run stream: ${this.run.id} already has ${MAX_SUBSCRIBERS_PER_RUN} subscribers`,
    );
    const member = new Member(
      sink,
      after,
      this.deps.highWaterMark ?? HIGH_WATER_MARK,
      (gone) => this.drop(gone),
    );

    this.members.add(member);

    return {
      ready: this.enqueue(() => this.catchUpMember(member)),
      leave: () => member.leave(),
    };
  }

  private async catchUpMember(member: Member): Promise<void> {
    await catchUp(this.deps, this.run, member);
    this.advanceCursor(member.cursor());
  }

  private advanceCursor(seen: string): void {
    if (BigInt(seen) > BigInt(this.cursor)) {
      this.cursor = seen;
    }
  }

  private drop(member: Member): void {
    this.members.delete(member);

    if (this.members.size === 0) {
      this.close();
    }
  }

  private close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.unsubscribe();
    this.onEmpty();
  }

  /** Serializes work on the feed's chain; the returned promise settles once the work ran, or once its failure was handled. */
  private enqueue(work: () => Promise<void>): Promise<void> {
    this.chain = this.chain.then(work).catch(() => this.fail());

    return this.chain;
  }

  /** A read that failed takes the whole feed down: every viewer is told, and the next open starts a fresh feed. */
  private fail(): void {
    for (const member of [...this.members]) {
      member.end("error");
    }
    this.close();
  }

  /** One GitHub read per burst: a ci_check that arrives while one is already queued collapses into it (FR7.6). */
  private enqueueLive(notification: RunNotification): void {
    if (this.closed) {
      return;
    }
    const collapses = notification.kind === "ci_check" && this.ciReadQueued;

    if (collapses) {
      return;
    }
    this.ciReadQueued ||= notification.kind === "ci_check";
    void this.enqueue(async () => {
      const frame = await LIVE_READS[notification.kind](this, notification);

      if (frame) {
        this.broadcast(frame);
      }
    });
  }

  async readCi(): Promise<RunStreamFrame | null> {
    this.ciReadQueued = false;

    return readCiCheck(this.deps, this.run);
  }

  /** Pages the rows written since the feed's cursor and forwards each to every viewer; returns null because it broadcasts as it goes. */
  async forwardNewAgentEvents(): Promise<null> {
    const pageSize = this.deps.pageSize ?? PAGE_SIZE;

    for (;;) {
      const page = await this.deps.events.listSince(
        this.run.id,
        this.cursor,
        pageSize,
      );

      this.forwardPage(page);

      if (page.length < pageSize || this.closed) {
        return null;
      }
    }
  }

  private forwardPage(page: readonly AgentRunEvent[]): void {
    for (const row of page) {
      this.cursor = row.id;
      this.broadcast(agentEventFrame(row));
    }
  }

  private broadcast(frame: RunStreamFrame): void {
    for (const member of [...this.members]) {
      member.emit(frame);
    }
  }

  /** After a lost LISTEN connection every viewer re-reads its snapshot and replays from its own cursor (FR7.5). */
  private async resync(): Promise<void> {
    for (const member of [...this.members]) {
      await this.catchUpMember(member);
    }
  }
}

/** The feeds this process holds, one per run with viewers. */
export class RunFeedRegistry {
  private readonly feeds = new Map<string, RunFeed>();

  constructor(private readonly deps: RunFeedDeps) {}

  /** Registers a viewer for the run, opening its feed when it is the first. Throws past {@link MAX_SUBSCRIBERS_PER_RUN}. */
  join(run: AssemblyRunRecord, sink: FrameSink, after: string): Membership {
    return this.feedFor(run).join(sink, after);
  }

  private feedFor(run: AssemblyRunRecord): RunFeed {
    const existing = this.feeds.get(run.id);

    if (existing) {
      return existing;
    }
    const feed = new RunFeed(run, this.deps, () => this.feeds.delete(run.id));

    this.feeds.set(run.id, feed);
    feed.start();

    return feed;
  }

  get feedCount(): number {
    return this.feeds.size;
  }

  subscriberCount(runId: string): number {
    return this.feeds.get(runId)?.size ?? 0;
  }
}
