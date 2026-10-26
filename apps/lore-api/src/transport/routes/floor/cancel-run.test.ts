import Hapi from "@hapi/hapi";
import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AUTH,
  LEGACY_TOKEN,
} from "@re-cinq/lore-server-core/test-helpers/http-mock.js";
import { registerBearerScope } from "../../http/bearer-scope.js";
import type { CancelRunFloor } from "../../../work/floor/cancel-run.js";
import { cancelRunRoute } from "./cancel-run.js";

const originalEnv = { ...process.env };

function floor(run: { finishedAt: string | null } | null) {
  return {
    runs: {
      get: vi
        .fn()
        .mockResolvedValue(
          run ? { run: { id: "plan-run", ...run }, bag: {} } : null,
        ),
      cancel: vi.fn().mockResolvedValue({ id: "plan-run" }),
    },
  } as unknown as CancelRunFloor;
}

function poolGranting(scopes: string[]): Pool {
  return {
    query: vi.fn().mockResolvedValue({ rows: [{ scopes }] }),
  } as unknown as Pool;
}

function serve(source: CancelRunFloor, pool: Pool | null = null) {
  const server = Hapi.server();

  registerBearerScope(server, () => pool);
  server.route(cancelRunRoute(() => source));

  return server;
}

function cancel(
  server: Hapi.Server,
  options: { headers?: Record<string, string>; payload?: object } = {},
) {
  return server.inject({
    method: "POST",
    url: "/api/assembly-runs/plan-run/cancel",
    headers: options.headers ?? AUTH,
    payload: options.payload,
  });
}

beforeEach(() => {
  process.env.LORE_INGEST_TOKEN = LEGACY_TOKEN;
});

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("POST /api/assembly-runs/{id}/cancel", () => {
  it("cancels open plan-run in gedaiu's name and answers 200 cancelled with its run_id", async () => {
    const source = floor({ finishedAt: null });

    const res = await cancel(serve(source), {
      payload: { requested_by: "gedaiu" },
    });

    expect({
      status: res.statusCode,
      body: res.result,
      cancelled: vi.mocked(source.runs.cancel).mock.calls,
    }).toEqual({
      status: 200,
      body: { cancelled: true, run_id: "plan-run" },
      cancelled: [["plan-run", "cancelled from the run page by gedaiu"]],
    });
  });

  it("cancels with the run page reason alone when the request has no body", async () => {
    const source = floor({ finishedAt: null });

    const res = await cancel(serve(source));

    expect({
      status: res.statusCode,
      cancelled: vi.mocked(source.runs.cancel).mock.calls,
    }).toEqual({
      status: 200,
      cancelled: [["plan-run", "cancelled from the run page"]],
    });
  });

  it("answers 404 for a run the floor does not have", async () => {
    const res = await cancel(serve(floor(null)));

    expect(res.statusCode).toBe(404);
  });

  it("answers 409 with the reason for a run that already finished", async () => {
    const res = await cancel(
      serve(floor({ finishedAt: "2026-10-07T09:00:00Z" })),
    );

    expect({ status: res.statusCode, body: res.result }).toMatchObject({
      status: 409,
      body: { error: "run plan-run already finished" },
    });
  });

  it("answers 401 and cancels nothing without a bearer token", async () => {
    const source = floor({ finishedAt: null });

    const res = await cancel(serve(source), { headers: {} });

    expect({
      status: res.statusCode,
      cancelled: vi.mocked(source.runs.cancel).mock.calls.length,
    }).toEqual({ status: 401, cancelled: 0 });
  });

  it("answers 403 and cancels nothing for a token granted only read", async () => {
    const source = floor({ finishedAt: null });

    const res = await cancel(serve(source, poolGranting(["read"])), {
      headers: { authorization: "Bearer read-only" },
    });

    expect({
      status: res.statusCode,
      cancelled: vi.mocked(source.runs.cancel).mock.calls.length,
    }).toEqual({ status: 403, cancelled: 0 });
  });
});
