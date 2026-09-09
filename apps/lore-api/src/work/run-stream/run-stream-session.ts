// One subscriber's multiplexed stream (specs/assembly-line-run-viz FR7). Subscribe BEFORE the snapshot so nothing lands in the gap; snapshot every state family, replay agent events from the cursor, say catchup_complete, then follow notifications by re-reading whatever they name. Backpressure is ours: past the high-water mark the stream ends and EventSource reconnects via Last-Event-ID.

import type { PassThrough } from "node:stream";
import type { AgentRunEventsRepository } from "@re-cinq/lore-shared/project/agent-run-events/agent-run-events-port.js";
import type {
  AssemblyRunRecord,
  AssemblyRunsPort,
} from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-port.js";
import type { TaskEventsRepository } from "@re-cinq/lore-shared/project/task-events/task-events-port.js";
import type { AgentRunEvent } from "@re-cinq/lore-shared/models/agent-run-event.js";
import {
  agentEventFrame,
  catchupFrame,
  ciCheckFrame,
  nodeStatusFrame,
  runStatusFrame,
  sseComment,
  sseFrame,
  taskEventFrame,
  type RunStreamFrame,
} from "./run-stream-frame.js";
import type {
  NotificationKind,
  NotifyFilter,
  RunNotification,
  RunNotifier,
} from "./run-notify-hub.js";

const PAGE_SIZE = 1000;
const HEARTBEAT_MS = 25_000;

/** Buffered bytes past which a client counts as too slow to keep. */
const HIGH_WATER_MARK = 1024 * 1024;

/** Notifications held while the snapshot is still being written; past this the reader is too slow (FR5.4). */
export const MAX_PENDING_NOTIFICATIONS = 1000;

export type PrStatusReader = (
  repo: string,
  prNumber: number,
) => Promise<Record<string, unknown> | null>;

export interface RunStreamDeps {
  run: AssemblyRunRecord;
  /** The agent-event cursor: rows with a greater id replay. */
  after: string;
  events: Pick<AgentRunEventsRepository, "listSince">;
  runs: Pick<AssemblyRunsPort, "getById" | "listStationRuns">;
  taskEvents: TaskEventsRepository;
  prStatus: PrStatusReader;
  notifier: RunNotifier;
  now?: () => Date;
  pageSize?: number;
  heartbeatMs?: number;
  highWaterMark?: number;
}

export interface RunStream {
  /** Unsubscribe, stop the heartbeat and end the response. Idempotent. */
  teardown: () => void;
  /** Settles once the snapshot and replay have drained and the live tail is attached. */
  ready: Promise<void>;
}

/** The PR a run's args name, if any: the identity its CI checks arrive under. */
export function prNumberOf(run: AssemblyRunRecord): number | null {
  const raw = run.args.pr_number;

  return typeof raw === "number" ? raw : null;
}

export function notifyFilterFor(run: AssemblyRunRecord): NotifyFilter {
  return {
    runId: run.id,
    taskId: run.taskId,
    repo: run.repo,
    prNumber: prNumberOf(run),
  };
}

/** Everything a Transform holds: readable side accumulates unread SSE response. */
const bufferedBytes = (stream: PassThrough): number =>
  stream.writableLength + stream.readableLength;

/** What a live notification can ask the session to re-read. */
interface LiveReads {
  drainHistory(): Promise<void>;
  emitNode(rowId: string | undefined): Promise<void>;
  emitRunStatus(): Promise<void>;
  emitTaskEvent(id: string | undefined): Promise<void>;
  emitCiCheck(): Promise<void>;
}

const LIVE_HANDLERS: Record<
  NotificationKind,
  (session: LiveReads, notification: RunNotification) => Promise<void>
> = {
  agent_event: (session) => session.drainHistory(),
  node_status: (session, notification) => session.emitNode(notification.row),
  run_status: (session) => session.emitRunStatus(),
  task_event: (session, notification) => session.emitTaskEvent(notification.id),
  ci_check: (session) => session.emitCiCheck(),
};

/** Owns every piece of state the snapshot, the replay, the live phase and teardown all touch. */
class RunStreamSession implements LiveReads {
  private closed = false;
  /** False until catch-up completes; until then notifications queue rather than run, so a client never sees a live row before its history. */
  private live = false;
  private cursor: string;
  private readonly pending: RunNotification[] = [];
  /** Serializes live work: two listSince calls must never race the cursor. */
  private chain: Promise<void> = Promise.resolve();
  /** A CI read already sits in the chain; further ci_check notifications collapse into it until it runs. */
  private ciReadQueued = false;
  private readonly cleanups: (() => void)[] = [];

  constructor(
    private readonly stream: PassThrough,
    private readonly deps: RunStreamDeps,
  ) {
    this.cursor = deps.after;
  }

  readonly teardown = (): void => {
    if (this.closed) {
      return;
    }
    this.closed = true;

    for (const cleanup of this.cleanups.splice(0)) {
      cleanup();
    }
    this.pending.length = 0;
    this.stream.end();
  };

  private write(chunk: string): void {
    if (this.closed) {
      return;
    }
    this.stream.write(chunk);

    if (
      bufferedBytes(this.stream) > (this.deps.highWaterMark ?? HIGH_WATER_MARK)
    ) {
      this.teardown();
    }
  }

  private emit(frame: RunStreamFrame): void {
    this.write(sseFrame(frame));
  }

  private deliverEvents(rows: readonly AgentRunEvent[]): void {
    for (const row of rows) {
      if (BigInt(row.id) <= BigInt(this.cursor)) {
        continue;
      }
      this.cursor = row.id;
      this.emit(agentEventFrame(row));
    }
  }

  subscribe(): void {
    this.cleanups.push(
      this.deps.notifier.subscribe(
        notifyFilterFor(this.deps.run),
        (notification) => this.onNotification(notification),
        () => this.enqueue(() => this.catchUp()),
      ),
    );

    const heartbeat = setInterval(
      () => this.write(sseComment("ping")),
      this.deps.heartbeatMs ?? HEARTBEAT_MS,
    );

    this.cleanups.push(() => clearInterval(heartbeat));
    this.stream.on("error", this.teardown);
  }

  private onNotification(notification: RunNotification): void {
    if (this.closed) {
      return;
    }

    if (this.live) {
      this.enqueueLive(notification);

      return;
    }
    this.pending.push(notification);

    if (this.pending.length > MAX_PENDING_NOTIFICATIONS) {
      this.teardown();
    }
  }

  private enqueue(work: () => Promise<void>): void {
    this.chain = this.chain.then(work).catch(this.teardown);
  }

  /** One GitHub read per burst: a ci_check that arrives while one is already queued is dropped, and the queued read serves both. */
  private enqueueLive(notification: RunNotification): void {
    const collapses = notification.kind === "ci_check" && this.ciReadQueued;

    if (collapses) {
      return;
    }
    this.ciReadQueued ||= notification.kind === "ci_check";
    this.enqueue(() => this.handle(notification));
  }

  /** Re-reads whatever the notification names; a row that is not there yet (or is gone) is skipped, and the next notification catches it. */
  private handle(notification: RunNotification): Promise<void> {
    return LIVE_HANDLERS[notification.kind](this, notification);
  }

  async emitNode(rowId: string | undefined): Promise<void> {
    const rows = await this.deps.runs.listStationRuns(this.deps.run.id);
    const row = rows.find((candidate) => candidate.id === rowId);

    if (row && !this.closed) {
      this.emit(nodeStatusFrame(row));
    }
  }

  async emitRunStatus(): Promise<void> {
    const run = await this.deps.runs.getById(this.deps.run.id);

    if (run && !this.closed) {
      this.emit(runStatusFrame(run));
    }
  }

  async emitTaskEvent(id: string | undefined): Promise<void> {
    const { taskId } = this.deps.run;

    if (taskId === null) {
      return;
    }
    const events = await this.deps.taskEvents.listForTask(taskId);
    const event = events.find((candidate) => candidate.id === id);

    if (event && !this.closed) {
      this.emit(taskEventFrame(event));
    }
  }

  async emitCiCheck(): Promise<void> {
    this.ciReadQueued = false;
    await this.readCiCheck();
  }

  private async readCiCheck(): Promise<void> {
    const { run } = this.deps;
    const prNumber = prNumberOf(run);

    if (prNumber === null) {
      return;
    }
    const status = await this.deps.prStatus(run.repo, prNumber);

    if (status && !this.closed) {
      const now = this.deps.now ?? (() => new Date());

      this.emit(ciCheckFrame(run.repo, prNumber, status, now()));
    }
  }

  /** Every state family as of now: the run, each visit, each task transition, the PR's checks. */
  private async snapshot(): Promise<void> {
    await this.emitRunStatus();
    const rows = await this.deps.runs.listStationRuns(this.deps.run.id);

    for (const row of rows) {
      this.emit(nodeStatusFrame(row));
    }
    await this.snapshotTaskEvents();
    await this.readCiCheck();
  }

  private async snapshotTaskEvents(): Promise<void> {
    const { taskId } = this.deps.run;

    if (taskId === null) {
      return;
    }

    for (const event of await this.deps.taskEvents.listForTask(taskId)) {
      this.emit(taskEventFrame(event));
    }
  }

  /** Pages history forward until a short page ends it, delivering as it goes; returns early when the stream closed mid-read. */
  async drainHistory(): Promise<void> {
    const pageSize = this.deps.pageSize ?? PAGE_SIZE;

    for (;;) {
      const page = await this.deps.events.listSince(
        this.deps.run.id,
        this.cursor,
        pageSize,
      );

      if (this.closed) {
        return;
      }
      this.deliverEvents(page);

      if (page.length < pageSize) {
        return;
      }
    }
  }

  /** Snapshot, replay, then flip live and run whatever queued meanwhile. Also the resync after a lost LISTEN connection, which is why it is idempotent about `live`. */
  async catchUp(): Promise<void> {
    await this.snapshot();
    await this.drainHistory();

    // The reads can have closed the stream while awaiting, so this re-reads rather than trusting the entry state.
    if (this.closed) {
      return;
    }
    this.emit(catchupFrame(this.cursor));
    this.live = true;

    for (const notification of this.pending.splice(0)) {
      this.enqueueLive(notification);
    }
  }
}

export function streamRun(stream: PassThrough, deps: RunStreamDeps): RunStream {
  const session = new RunStreamSession(stream, deps);

  session.subscribe();

  const ready = session.catchUp();

  ready.catch(session.teardown);

  return { teardown: session.teardown, ready };
}
