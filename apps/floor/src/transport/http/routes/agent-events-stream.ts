/** GET /api/agent-events/stream/{assemblyRunId} — the stack's first SSE endpoint (FR2.x); subscribes BEFORE the first `listSince` and de-dupes on monotonic id for a lossless replay→live handoff. Backpressure is ours, not the bus's — past the high-water mark the stream ends and EventSource reconnects via `Last-Event-ID`. */

import { apiError } from "@re-cinq/lore-shared/http/api-error.js";
import { PassThrough } from "node:stream";
import { pipeline } from "../../../outbound/queues.js";
import {
  agentEventBus,
  MAX_BUFFERED_EVENTS,
} from "../../../work/agent/agent-event-bus.js";
import type {
  Request,
  ResponseObject,
  ResponseToolkit,
  ServerRoute,
} from "@hapi/hapi";
import type { AgentEventHandler } from "../../../work/agent/agent-event-bus.js";
import type { AgentRunEventRow } from "@re-cinq/lore-shared";

const PAGE_SIZE = 1000;
const HEARTBEAT_MS = 25_000;

/** Buffered bytes past which a client counts as too slow to keep. */
const HIGH_WATER_MARK = 1024 * 1024;

export function sseFrame(row: AgentRunEventRow): string {
  return `id: ${row.id}\nevent: agent-event\ndata: ${JSON.stringify(row)}\n\n`;
}

export function sseComment(text: string): string {
  return `: ${text}\n\n`;
}

const numericOrNull = (raw: unknown): string | null =>
  typeof raw === "string" && /^\d+$/.test(raw) ? raw : null;

/** `Last-Event-ID` wins over `?after`; anything non-numeric replays from the start. */
export function parseCursor(lastEventId: unknown, after: unknown): string {
  return numericOrNull(lastEventId) ?? numericOrNull(after) ?? "0";
}

export interface RunEventStreamDeps {
  assemblyLineId: string;
  after: string;
  events: {
    listSince: (
      assemblyLineId: string,
      afterId: string,
      limit: number,
    ) => Promise<AgentRunEventRow[]>;
  };
  bus: {
    subscribe: (
      assemblyLineId: string,
      handler: AgentEventHandler,
      onOverflow?: () => void,
    ) => () => void;
  };
  pageSize?: number;
  heartbeatMs?: number;
  highWaterMark?: number;
}

export interface RunEventStream {
  /** Unsubscribe, stop the heartbeat and end the response. Idempotent. */
  teardown: () => void;
  /** Settles once the replay has drained and the live tail is attached. */
  ready: Promise<void>;
}

/** Everything a Transform holds: readable side accumulates unread SSE response. */
const bufferedBytes = (stream: PassThrough): number =>
  stream.writableLength + stream.readableLength;

/** One subscriber's stream. Owns every piece of state the catch-up phase, the live phase and teardown all touch: whether the stream is closed, whether it has caught up, how far it has read, and what arrived while it was still reading. */
class RunEventSession {
  private closed = false;
  /** False until catch-up completes; until then bus rows are buffered rather than written, so a client never sees a live row before its history. */
  private live = false;
  private cursor: string;
  private readonly buffered: AgentRunEventRow[] = [];
  private readonly pageSize: number;
  private readonly highWaterMark: number;

  // Collected rather than named: the overflow callback needs `teardown`, which needs the unsubscribe the same call returns.
  private readonly cleanups: (() => void)[] = [];

  constructor(
    private readonly stream: PassThrough,
    private readonly deps: RunEventStreamDeps,
  ) {
    this.cursor = deps.after;
    this.pageSize = deps.pageSize ?? PAGE_SIZE;
    this.highWaterMark = deps.highWaterMark ?? HIGH_WATER_MARK;
  }

  readonly teardown = (): void => {
    if (this.closed) {
      return;
    }
    this.closed = true;

    for (const cleanup of this.cleanups.splice(0)) {
      cleanup();
    }
    this.buffered.length = 0;
    this.stream.end();
  };

  private write(chunk: string): void {
    if (this.closed) {
      return;
    }
    this.stream.write(chunk);

    if (bufferedBytes(this.stream) > this.highWaterMark) {
      this.teardown();
    }
  }

  private deliver(rows: readonly AgentRunEventRow[]): void {
    for (const row of rows) {
      if (BigInt(row.id) <= BigInt(this.cursor)) {
        continue;
      }
      this.cursor = row.id;
      this.write(sseFrame(row));
    }
  }

  // The bus's MAX_BUFFERED_EVENTS guard cannot protect this array — during catch-up the backlog sits HERE. Same cap, same recovery (end + EventSource replay).
  private buffer(rows: AgentRunEventRow[]): void {
    if (this.closed) {
      return;
    }
    this.buffered.push(...rows);

    if (this.buffered.length > MAX_BUFFERED_EVENTS) {
      this.teardown();
    }
  }

  subscribe(): void {
    this.cleanups.push(
      this.deps.bus.subscribe(
        this.deps.assemblyLineId,
        (rows) => (this.live ? this.deliver(rows) : this.buffer(rows)),
        this.teardown,
      ),
    );

    const heartbeat = setInterval(
      () => this.write(sseComment("ping")),
      this.deps.heartbeatMs ?? HEARTBEAT_MS,
    );

    this.cleanups.push(() => clearInterval(heartbeat));
    this.stream.on("error", this.teardown);
  }

  /** Pages history forward until a short page ends it, delivering as it goes; returns early when the stream closed mid-read, which the caller re-checks before declaring catch-up complete. */
  private async drainHistory(): Promise<void> {
    for (;;) {
      const page = await this.deps.events.listSince(
        this.deps.assemblyLineId,
        this.cursor,
        this.pageSize,
      );

      if (this.closed) {
        return;
      }
      this.deliver(page);

      if (page.length < this.pageSize) {
        return;
      }
    }
  }

  /** Reads history to the end, then flips live and flushes whatever the bus delivered meanwhile. */
  async catchUp(): Promise<void> {
    await this.drainHistory();

    // The drain can have closed the stream while it was awaiting, so this re-reads rather than trusting the entry state.
    if (this.closed) {
      return;
    }
    this.write(
      `event: catchup-complete\ndata: ${JSON.stringify({ lastId: this.cursor })}\n\n`,
    );
    this.live = true;
    this.deliver(this.buffered.splice(0));
  }
}

export function streamRunEvents(
  stream: PassThrough,
  deps: RunEventStreamDeps,
): RunEventStream {
  const session = new RunEventSession(stream, deps);

  session.subscribe();

  const ready = session.catchUp();

  ready.catch(session.teardown);

  return { teardown: session.teardown, ready };
}

type StreamRouteDeps = Pick<
  RunEventStreamDeps,
  "events" | "bus" | "pageSize" | "heartbeatMs" | "highWaterMark"
>;

function resolveStreamRouteDeps(
  deps: StreamRouteDeps | undefined,
): StreamRouteDeps {
  const { events, bus, pageSize, heartbeatMs, highWaterMark } = deps ?? {};

  return {
    events: events ?? pipeline().agentRunEvents,
    bus: bus ?? agentEventBus(),
    pageSize,
    heartbeatMs,
    highWaterMark,
  };
}

/** The bus refuses past MAX_SUBSCRIBERS_PER_RUN (capacity, not a bug → 503); matched on message prefix since subscribe throws a plain Error. Anything else rethrows as-is. */
function rethrowStreamStartError(err: unknown): never {
  const isCapacityError =
    err instanceof Error && err.message.startsWith("agent event bus: ");

  if (!isCapacityError) {
    throw err;
  }

  throw apiError(503)("too many subscribers for this run");
}

function startRunEventStream(
  stream: PassThrough,
  assemblyLineId: string,
  after: string,
  deps: StreamRouteDeps | undefined,
): RunEventStream {
  try {
    return streamRunEvents(stream, {
      assemblyLineId,
      after,
      ...resolveStreamRouteDeps(deps),
    });
  } catch (err) {
    rethrowStreamStartError(err);
  }
}

/** Resolves this request's cursor (`Last-Event-ID` over `?after`) and opens the stream for the run it names. */
function startStreamForRequest(
  request: Request,
  stream: PassThrough,
  deps: StreamRouteDeps | undefined,
): RunEventStream {
  const after = parseCursor(
    request.headers["last-event-id"],
    request.query.after,
  );

  return startRunEventStream(stream, request.params.assemblyRunId, after, deps);
}

/** The SSE headers, set once here so the route body is just the stream's lifecycle. */
function sseResponse(h: ResponseToolkit, stream: PassThrough): ResponseObject {
  return (
    h
      .response(stream)
      .type("text/event-stream")
      .header("cache-control", "no-cache, no-transform")
      .header("x-accel-buffering", "no")
      // Compression buffers SSE frames; identity encoding keeps frames on the wire immediately.
      .header("content-encoding", "identity")
  );
}

export function agentEventsStreamRoute(deps?: StreamRouteDeps): ServerRoute {
  return {
    method: "GET",
    path: "/api/agent-events/stream/{assemblyRunId}",
    options: { auth: "ingest-token" },
    handler: (request, h) => {
      const stream = new PassThrough();
      const run = startStreamForRequest(request, stream, deps);

      const { req } = request.raw;

      req.on("close", run.teardown);

      return sseResponse(h, stream);
    },
  };
}
