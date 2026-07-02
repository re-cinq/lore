import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { buildServer } from "./build-server.js";
import { useRateLimitSafeClock, makePool, AUTH, LEGACY_TOKEN } from "@re-cinq/lore-server-core/test-helpers/http-mock.js";

// The strangler bridge (ADR-033): hapi hosts the server via `buildServer`, and
// every not-yet-migrated request still flows through the legacy dispatcher
// (`handleApiRoute`). These prove the seam — a request reaches the legacy
// handler through hapi, the raw response it writes is returned via `h.abandon`,
// and the legacy auth/404/body gates are preserved unchanged. (Native routes
// like /healthz and /dist have their own suites.)

const originalEnv = { ...process.env };
const build = () => buildServer(() => null);

describe("buildServer strangler bridge", () => {
  useRateLimitSafeClock();
  beforeEach(() => {
    process.env.LORE_INGEST_TOKEN = LEGACY_TOKEN;
  });
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("returns 404 for a route the legacy dispatcher does not handle", async () => {
    const res = await build().inject({ method: "GET", url: "/api/nope", headers: AUTH });
    expect(res.statusCode).toBe(404);
  });

  it("preserves the legacy 401 for a protected route without a bearer token", async () => {
    const res = await build().inject({ method: "GET", url: "/api/repo-status?repo=o/r" });
    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.payload)).toEqual({ error: "unauthorized" });
  });

  it("preserves the 1 MB Content-Length gate (413) on POST", async () => {
    const res = await build().inject({
      method: "POST",
      url: "/api/task",
      headers: { ...AUTH, "content-length": String(2 * 1_048_576) },
      payload: "{}",
    });
    expect(res.statusCode).toBe(413);
    expect(JSON.parse(res.payload)).toEqual({ error: "request body too large" });
  });

  it("delivers the POST body to the legacy handler through the bridge", async () => {
    // The shim carries the body across the seam: handleTaskPost parses it and
    // echoes task_id/priority back, which can only come from the request body.
    const pool = makePool();
    pool.query.mockResolvedValue({ rows: [] });
    const res = await buildServer(() => pool).inject({
      method: "POST",
      url: "/api/task",
      headers: AUTH,
      payload: JSON.stringify({ action: "set-priority", task_id: "task-123", priority: "immediate" }),
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload)).toMatchObject({ ok: true, task_id: "task-123", priority: "immediate" });
  });
});
