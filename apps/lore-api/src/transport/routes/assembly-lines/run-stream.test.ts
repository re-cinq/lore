import Hapi from "@hapi/hapi";
import { describe, expect, it } from "vitest";
import { InMemoryAssemblyRuns } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-memory.js";
import { InMemoryAgentRunEvents } from "@re-cinq/lore-shared/project/agent-run-events/agent-run-events-memory.js";
import { InMemoryTaskEvents } from "@re-cinq/lore-shared/project/task-events/task-events-memory.js";
import {
  InMemoryRunNotifier,
  MAX_SUBSCRIBERS_PER_RUN,
} from "../../../work/run-stream/run-notify-hub.js";
import { parseCursor, runStreamRoute } from "./run-stream.js";
import type { RunStreamRouteDeps } from "./run-stream.js";

const flush = (): Promise<void> =>
  new Promise((resolve) => setImmediate(resolve));

function deps(over: Partial<RunStreamRouteDeps> = {}): RunStreamRouteDeps {
  return {
    runs: new InMemoryAssemblyRuns(),
    events: new InMemoryAgentRunEvents(),
    taskEvents: new InMemoryTaskEvents(),
    prStatus: async () => null,
    notifier: new InMemoryRunNotifier(),
    heartbeatMs: 60_000,
    ...over,
  };
}

function serve(routeDeps: RunStreamRouteDeps) {
  const server = Hapi.server();

  server.auth.scheme("stub", () => ({
    authenticate: (_r, h) => h.authenticated({ credentials: {} }),
  }));
  server.auth.strategy("bearer-scope", "stub");
  server.auth.default("bearer-scope");
  server.route(runStreamRoute(() => null, routeDeps));

  return server;
}

async function seededRun(runs: InMemoryAssemblyRuns) {
  return runs.start({ blueprintName: "implementation", repo: "o/r" });
}

describe("parseCursor", () => {
  it("prefers the Last-Event-ID header over the after query, and replays from 0 for a non-numeric cursor", () => {
    expect(parseCursor("99", "7")).toBe("99");
    expect(parseCursor(undefined, "7")).toBe("7");
    expect(parseCursor("not-a-number", undefined)).toBe("0");
  });
});

describe("GET /api/assembly-runs/{id}/stream", () => {
  it("returns 404 for a run that does not exist", async () => {
    const res = await serve(deps()).inject("/api/assembly-runs/nope/stream");

    expect(res.statusCode).toBe(404);
  });

  it("returns text/event-stream with no-cache no-transform, X-Accel-Buffering no and identity encoding, and reaches catchup_complete", async () => {
    const runs = new InMemoryAssemblyRuns();
    const id = await seededRun(runs);
    let opened: { ready: Promise<void>; teardown: () => void } | undefined;
    const server = serve(deps({ runs, onOpen: (live) => (opened = live) }));
    const injected = server.inject({
      method: "GET",
      url: `/api/assembly-runs/${id}/stream`,
      headers: { "accept-encoding": "gzip" },
    });

    await flush();
    await opened?.ready;
    opened?.teardown();
    const res = await injected;

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/event-stream");
    expect(res.headers["cache-control"]).toBe("no-cache, no-transform");
    expect(res.headers["x-accel-buffering"]).toBe("no");
    expect(res.headers["content-encoding"]).toBe("identity");
    expect(res.payload).toContain("event: run_status");
    expect(res.payload).toContain("event: catchup_complete");
  });

  it("returns 503 when the run already has its maximum subscribers", async () => {
    const runs = new InMemoryAssemblyRuns();
    const id = await seededRun(runs);
    const notifier = new InMemoryRunNotifier();
    const filter = { runId: id, taskId: null, repo: "o/r", prNumber: null };

    for (let i = 0; i < MAX_SUBSCRIBERS_PER_RUN; i++) {
      notifier.subscribe(filter, () => {});
    }
    const res = await serve(deps({ runs, notifier })).inject(
      `/api/assembly-runs/${id}/stream`,
    );

    expect(res.statusCode).toBe(503);
  });

  it("returns 500, not 503, when subscribe fails for a reason other than capacity", async () => {
    const runs = new InMemoryAssemblyRuns();
    const id = await seededRun(runs);
    const notifier = {
      subscribe: () => {
        throw new TypeError("handler is not a function");
      },
    };
    const res = await serve(deps({ runs, notifier })).inject(
      `/api/assembly-runs/${id}/stream`,
    );

    expect(res.statusCode).toBe(500);
  });
});
