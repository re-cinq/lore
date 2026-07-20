/**
 * GET /api/agent-events/stream/{assemblyLineId} — the stack's first SSE
 * endpoint (FR2.x). hapi has no SSE support, so the handler returns a
 * `PassThrough` and `streamRunEvents` drives it.
 *
 * The whole point of the sequence below is a lossless handoff between the
 * durable replay and the live tail. Subscribing BEFORE the first `listSince`
 * and buffering what arrives means a row written mid-replay is held rather than
 * missed; de-duplicating on the monotonic id means the same row arriving from
 * both sides is written once. Inverting the order drops events in that gap
 * silently, which is why both properties are tested rather than asserted here.
 *
 * BACKPRESSURE IS OURS, NOT THE BUS'S. The bus drains a subscriber
 * synchronously, so its overflow guard can never fire for a merely slow socket
 * — that data sits in this PassThrough. Past the high-water mark the stream is
 * ended: the browser's EventSource reconnects with `Last-Event-ID` and the
 * replay heals the gap, so dropping costs latency and never data.
 */

import Boom from "@hapi/boom";
import { PassThrough } from "node:stream";
import { agentRunEvents } from "../../../kernel/queues.js";
import { agentEventBus } from "../../../jobs/agent/agent-event-bus.js";
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

/** Everything a Transform holds on either side — the readable half is where an
 *  unread SSE response actually piles up. */
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

  // Collected rather than named: the bus's overflow callback needs `teardown`,
  // and `teardown` needs the unsubscribe the same call returns.
  const cleanups: (() => void)[] = [];

  const teardown = (): void => {
    if (closed) {
      return;
    }
    closed = true;

    for (const cleanup of cleanups.splice(0)) {
      cleanup();
    }
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

  cleanups.push(
    deps.bus.subscribe(
      deps.assemblyLineId,
      (rows) => (live ? deliver(rows) : buffered.push(...rows)),
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

export function agentEventsStreamRoute(
  deps?: Pick<
    RunEventStreamDeps,
    "events" | "bus" | "pageSize" | "heartbeatMs" | "highWaterMark"
  >,
): ServerRoute {
  return {
    method: "GET",
    path: "/api/agent-events/stream/{assemblyLineId}",
    options: { auth: "ingest-token" },
    handler: (request, h) => {
      const stream = new PassThrough();
      const assemblyLineId = request.params.assemblyLineId;
      const after = parseCursor(
        request.headers["last-event-id"],
        request.query.after,
      );

      let run: RunEventStream;

      try {
        run = streamRunEvents(stream, {
          assemblyLineId,
          after,
          events: deps?.events ?? agentRunEvents(),
          bus: deps?.bus ?? agentEventBus(),
          pageSize: deps?.pageSize,
          heartbeatMs: deps?.heartbeatMs,
          highWaterMark: deps?.highWaterMark,
        });
      } catch (err) {
        // The bus refuses past MAX_SUBSCRIBERS_PER_LINE. That is capacity, not a
        // bug in the request — 503 tells the client to come back. Anything else
        // is a real fault and must surface as a 500; swallowing it here would
        // report every programming error as backpressure. Matched on the bus's
        // own message prefix because subscribe throws a plain Error — if that
        // ever becomes a typed error, match the type instead.
        const capacity =
          err instanceof Error && err.message.startsWith("agent event bus: ");

        if (!capacity) {
          throw err;
        }

        throw Boom.serverUnavailable("too many subscribers for this run");
      }

      request.raw.req.on("close", run.teardown);

      return (
        h
          .response(stream)
          .type("text/event-stream")
          .header("cache-control", "no-cache, no-transform")
          .header("x-accel-buffering", "no")
          // Compressing an SSE stream would let an intermediary hold frames back
          // until a compression block fills; identity keeps each frame on the wire.
          .header("content-encoding", "identity")
      );
    },
  };
}
