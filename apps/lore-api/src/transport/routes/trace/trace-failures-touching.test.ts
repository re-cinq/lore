import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { createDgraphClient, ingestSpecTrace } from "@re-cinq/lore-shared";
import { dgraphReachable } from "@re-cinq/lore-shared/lib/dgraph-test-gate.js";
import { buildServer } from "../../../app/build-server.js";
import {
  makePool,
  useRateLimitSafeClock,
  AUTH,
  LEGACY_TOKEN,
} from "@re-cinq/lore-server-core/test-helpers/http-mock.js";
import { setPool } from "@re-cinq/lore-server-core/platform/db.js";

const originalEnv = { ...process.env };
const DGRAPH_HTTP = process.env.DGRAPH_HTTP ?? "http://localhost:8081";

const get = (url: string) =>
  buildServer(() => makePool() as never).inject({
    method: "GET",
    url,
    headers: AUTH,
  });

describe("GET /api/repos/:owner/:repo/trace/failures-touching", () => {
  useRateLimitSafeClock();
  beforeEach(() => {
    process.env.LORE_INGEST_TOKEN = LEGACY_TOKEN;
    delete process.env.LORE_DGRAPH_HTTP;
    setPool(makePool() as unknown as Pool);
  });
  afterEach(() => {
    process.env = { ...originalEnv };
    setPool(null as unknown as Pool);
  });

  it("returns 400 when no path names the source file", async () => {
    const res = await get("/api/repos/o/r/trace/failures-touching");

    expect(res.statusCode).toBe(400);
    expect(res.result).toEqual({ error: "path query param required" });
  });

  it("returns an empty list when no Dgraph client is configured", async () => {
    const res = await get(
      "/api/repos/o/r/trace/failures-touching?path=src/a.ts",
    );

    expect(res.result).toEqual({ failures: [] });
  });
});

const reachable = await dgraphReachable();

describe.skipIf(!reachable)("GET trace/failures-touching (live Dgraph)", () => {
  useRateLimitSafeClock();
  beforeEach(() => {
    setPool(makePool() as unknown as Pool);
  });
  afterEach(() => {
    process.env = { ...originalEnv };
    setPool(null as unknown as Pool);
  });

  it("returns the validate failure recorded on src/widget.ts under a failures key", async () => {
    process.env.LORE_INGEST_TOKEN = LEGACY_TOKEN;
    process.env.LORE_DGRAPH_HTTP = DGRAPH_HTTP;
    const repo = `test-failures/${randomUUID()}`;
    const stationRunId = randomUUID();

    await ingestSpecTrace(createDgraphClient(process.env)!, repo, "failure", {
      outcome: "validate-failed",
      assemblyRunId: "run-7",
      stationRunId,
      nodeId: "validate",
      iteration: 1,
      failureClass: "unknown",
      failureDetail: "src/widget.ts(12,5): error TS2345: bad argument",
      commit: "sha-red",
      occurredAt: "2026-01-01T00:00:00.000Z",
    });
    const res = await get(
      `/api/repos/${repo}/trace/failures-touching?path=src/widget.ts`,
    );

    expect(JSON.parse(res.payload)).toEqual({
      failures: [
        {
          stationRunId,
          nodeId: "validate",
          iteration: 1,
          failureClass: "unknown",
          failureDetail: "src/widget.ts(12,5): error TS2345: bad argument",
          commit: "sha-red",
          occurredAt: "2026-01-01T00:00:00Z",
        },
      ],
    });
  });
});
