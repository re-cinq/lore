/** GET /api/agent-events/stream/{assemblyRunId} — the stack's first SSE endpoint (FR2.x); subscribes BEFORE the first `listSince` and de-dupes on monotonic id for a lossless replay→live handoff. Backpressure is ours, not the bus's — past the high-water mark the stream ends and EventSource reconnects via `Last-Event-ID`. */

import { apiError } from "../api-error.js";
import { PassThrough } from "node:stream";
import { pipeline } from "../../../kernel/queues.js";
import {
  agentEventBus,
  MAX_BUFFERED_EVENTS,
} from "../../../jobs/agent/agent-event-bus.js";
import type { ServerRoute } from "@hapi/hapi";
import type { AgentEventHandler } from "../../../jobs/agent/agent-event-bus.js";
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

export function streamRunEvents(
  stream: PassThrough,
  deps: RunEventStreamDeps,
): RunEventStream {
  const pageSize = deps.pageSize ?? PAGE_SIZE;
  const highWaterMark = deps.highWaterMark ?? HIGH_WATER_MARK;

  let closed = false;
  let live = false;
  let cursor = deps.after;
  const buffered: AgentRunEventRow[] = [];

  // Collected rather than named: the overflow callback needs `teardown`, which needs the unsubscribe the same call returns.
  const cleanups: (() => void)[] = [];

  const teardown = (): void => {
    if (closed) {
      return;
    }
    closed = true;

    for (const cleanup of cleanups.splice(0)) {
      cleanup();
    }
    buffered.length = 0;
    stream.end();
  };

  const write = (chunk: string): void => {
    if (closed) {
      return;
    }
    stream.write(chunk);

    if (bufferedBytes(stream) > highWaterMark) {
      teardown();
    }
  };

  const deliver = (rows: readonly AgentRunEventRow[]): void => {
    for (const row of rows) {
      if (BigInt(row.id) <= BigInt(cursor)) {
        continue;
      }
      cursor = row.id;
      write(sseFrame(row));
    }
  };

  // The bus's MAX_BUFFERED_EVENTS guard cannot protect this array — during catch-up the backlog sits HERE. Same cap, same recovery (end + EventSource replay).
  const buffer = (rows: AgentRunEventRow[]): void => {
    if (closed) {
      return;
    }
    buffered.push(...rows);

    if (buffered.length > MAX_BUFFERED_EVENTS) {
      teardown();
    }
  };

  cleanups.push(
    deps.bus.subscribe(
      deps.assemblyLineId,
      (rows) => (live ? deliver(rows) : buffer(rows)),
      teardown,
    ),
  );

  const heartbeat = setInterval(
    () => write(sseComment("ping")),
    deps.heartbeatMs ?? HEARTBEAT_MS,
  );

  cleanups.push(() => clearInterval(heartbeat));
  stream.on("error", teardown);

  const ready = (async () => {
    for (;;) {
      const page = await deps.events.listSince(
        deps.assemblyLineId,
        cursor,
        pageSize,
      );

      if (closed) {
        return;
      }
      deliver(page);

      if (page.length < pageSize) {
        break;
      }
    }

    if (closed) {
      return;
    }
    write(
      `event: catchup-complete\ndata: ${JSON.stringify({ lastId: cursor })}\n\n`,
    );
    live = true;
    deliver(buffered.splice(0));
  })();

  ready.catch(teardown);

  return { teardown, ready };
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

export function agentEventsStreamRoute(deps?: StreamRouteDeps): ServerRoute {
  return {
    method: "GET",
    path: "/api/agent-events/stream/{assemblyRunId}",
    options: { auth: "ingest-token" },
    handler: (request, h) => {
      const stream = new PassThrough();
      const assemblyLineId = request.params.assemblyRunId;
      const after = parseCursor(
        request.headers["last-event-id"],
        request.query.after,
      );
      const run = startRunEventStream(stream, assemblyLineId, after, deps);

      request.raw.req.on("close", run.teardown);

      return (
        h
          .response(stream)
          .type("text/event-stream")
          .header("cache-control", "no-cache, no-transform")
          .header("x-accel-buffering", "no")
          // Compression buffers SSE frames; identity encoding keeps frames on the wire immediately.
          .header("content-encoding", "identity")
      );
    },
  };
}
