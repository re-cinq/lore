import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { buildServer } from "../../../app/build-server.js";
import {
  makePool,
  useRateLimitSafeClock,
  AUTH,
  LEGACY_TOKEN,
} from "@re-cinq/lore-server-core/test-helpers/http-mock.js";

const originalEnv = { ...process.env };

const post = (body: unknown, pool: ReturnType<typeof makePool>) =>
  buildServer(() => pool as any).inject({
    method: "POST",
    url: "/api/repos/o/r/ingest-graph",
    headers: AUTH,
    payload: JSON.stringify(body),
  });
const insertCalls = (pool: ReturnType<typeof makePool>) =>
  pool.query.mock.calls.filter((c) =>
    String(c[0]).includes("INSERT INTO pipeline.events"),
  );

describe("POST /api/repos/:owner/:repo/ingest-graph", () => {
  useRateLimitSafeClock();
  beforeEach(() => {
    process.env.LORE_INGEST_TOKEN = LEGACY_TOKEN;
  });
  afterEach(() => {
    process.env = { ...originalEnv };
    vi.clearAllMocks();
  });

  it("answers 410 for the specs kind of o/r, naming the workflow step that replaced the route, and inserts no event", async () => {
    const pool = makePool();
    const res = await post({ kinds: ["specs"], commit: "abc123" }, pool);

    expect(res.statusCode).toBe(410);
    expect(res.result).toEqual({
      error:
        "Specs and ADRs are no longer projected by this route. The repository's lore-ingest.yml posts them itself with `lore-code-trace docs --post`: update the workflow from the onboarding template.",
    });
    expect(insertCalls(pool)).toEqual([]);
  });

  it("rejects the tests kind with 400 (test projection is CI-only)", async () => {
    const pool = makePool();
    const res = await post({ kinds: ["tests"] }, pool);

    expect(res.statusCode).toBe(400);
    expect(insertCalls(pool)).toHaveLength(0);
  });

  it("parses a JSON body sent with a non-JSON Content-Type", async () => {
    const pool = makePool();
    const res = await buildServer(() => pool as any).inject({
      method: "POST",
      url: "/api/repos/o/r/ingest-graph",
      headers: { ...AUTH, "content-type": "application/x-www-form-urlencoded" },
      payload: JSON.stringify({ kinds: ["tests"] }),
    });

    expect(res.statusCode).toBe(400);
    expect(insertCalls(pool)).toHaveLength(0);
  });

  it("returns 400 on an unparseable body", async () => {
    const pool = makePool();
    const res = await buildServer(() => pool as any).inject({
      method: "POST",
      url: "/api/repos/o/r/ingest-graph",
      headers: AUTH,
      payload: "{not json",
    });

    expect(res.statusCode).toBe(400);
    expect(insertCalls(pool)).toHaveLength(0);
  });
});
