// GET /api/assembly-runs/{id}/stream — the run page's one live connection (specs/assembly-line-run-viz FR7, ADR-037 amendment 2026-09): agent events, node status, run status, task events and CI checks multiplexed over SSE, served here rather than on the Floor so the browser's proxy talks to one backend and the fan-out is Postgres, not a single-replica process.

import { PassThrough } from "node:stream";
import type { Pool } from "pg";
import type {
  Request,
  ResponseObject,
  ResponseToolkit,
  ServerRoute,
} from "@hapi/hapi";
import { apiError } from "@re-cinq/lore-shared/http/api-error.js";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { PgAssemblyRuns } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-pg.js";
import { PgAgentRunEvents } from "@re-cinq/lore-shared/project/agent-run-events/agent-run-events-pg.js";
import { PgTaskEvents } from "@re-cinq/lore-shared/project/task-events/task-events-pg.js";
import type { AssemblyRunRecord } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-port.js";
import { bearerScope } from "../../http/bearer-scope.js";
import { zodResponse } from "../../http/zod-response.js";
import { fetchPrStatus } from "../../../outbound/github-client.js";
import { RunStreamFrameSchema } from "../../../work/run-stream/run-stream-frame.js";
import { pgRunNotifier } from "../../../work/run-stream/run-notify-hub.js";
import {
  streamRun,
  type RunStream,
  type RunStreamDeps,
} from "../../../work/run-stream/run-stream-session.js";

export type RunStreamRouteDeps = Omit<RunStreamDeps, "run" | "after"> & {
  /** Hands a test the opened stream: hapi's inject settles a streamed response only once it ends, so a test needs the handle to end it. */
  onOpen?: (live: RunStream) => void;
};

const numericOrNull = (raw: unknown): string | null =>
  typeof raw === "string" && /^\d+$/.test(raw) ? raw : null;

/** `Last-Event-ID` wins over `?after`; anything non-numeric replays from the start. */
export function parseCursor(lastEventId: unknown, after: unknown): string {
  return numericOrNull(lastEventId) ?? numericOrNull(after) ?? "0";
}

export function runStreamRoute(
  getPool: () => Pool | null,
  deps?: RunStreamRouteDeps,
): ServerRoute {
  return {
    method: "GET",
    path: "/api/assembly-runs/{id}/stream",
    options: zodResponse(bearerScope("read"), RunStreamFrameSchema, {
      name: "RunStreamFrame",
      description:
        "Server-Sent Events: one `event:` per frame type, `data:` the frame; only agent_event frames carry an `id:` (the Last-Event-ID cursor)",
      contentType: "text/event-stream",
      errors: [404],
    }),
    handler: (request, h) => serveRunStream(getPool, deps, request, h),
  };
}

async function serveRunStream(
  getPool: () => Pool | null,
  injected: RunStreamRouteDeps | undefined,
  request: Request,
  h: ResponseToolkit,
): Promise<ResponseObject> {
  const deps = resolveDeps(getPool(), injected);
  const run = await deps.runs.getById(request.params.id);

  enforceTrue(run !== null, apiError(404), "assembly run not found");
  const stream = new PassThrough();
  const live = startStream(stream, run, request, deps);

  const { req } = request.raw;

  req.on("close", live.teardown);
  deps.onOpen?.(live);

  return sseResponse(h, stream);
}

/** The production wiring, or the injected one; a deployment without a database cannot stream. */
function resolveDeps(
  pool: Pool | null,
  deps: RunStreamRouteDeps | undefined,
): RunStreamRouteDeps {
  if (deps) {
    return deps;
  }
  enforceTrue(pool !== null, apiError(503), "database unavailable");

  return {
    runs: new PgAssemblyRuns(pool),
    events: new PgAgentRunEvents(pool),
    taskEvents: new PgTaskEvents(pool),
    prStatus: fetchPrStatus,
    notifier: pgRunNotifier(),
  };
}

function startStream(
  stream: PassThrough,
  run: AssemblyRunRecord,
  request: Request,
  deps: RunStreamRouteDeps,
): RunStream {
  const after = parseCursor(
    request.headers["last-event-id"],
    request.query.after,
  );

  try {
    return streamRun(stream, { ...deps, run, after });
  } catch (err) {
    rethrowStreamStartError(err);
  }
}

/** The hub refuses past its per-run cap (capacity, not a bug → 503); matched on message prefix since subscribe throws a plain Error. Anything else rethrows as-is. */
function rethrowStreamStartError(err: unknown): never {
  const isCapacityError =
    err instanceof Error && err.message.startsWith("run stream: ");

  if (!isCapacityError) {
    throw err;
  }

  throw apiError(503)("too many subscribers for this run");
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
