import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { buildServer } from "../../../app/build-server.js";
import {
  makePool,
  useRateLimitSafeClock,
  AUTH,
  LEGACY_TOKEN,
} from "@re-cinq/lore-server-core/test-helpers/http-mock.js";

const originalEnv = { ...process.env };

const get = (url: string) =>
  buildServer(() => makePool() as never).inject({
    method: "GET",
    url,
    headers: AUTH,
  });

// #1768 unmet criterion: GET /api/repos/:o/:r/trace/callers must exist.
// "callers" is absent from TRACE_KINDS today, so every request returns 404.
describe("GET /api/repos/:owner/:repo/trace/callers", () => {
  useRateLimitSafeClock();
  beforeEach(() => {
    process.env.LORE_INGEST_TOKEN = LEGACY_TOKEN;
    delete process.env.LORE_DGRAPH_HTTP;
  });
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("callers is a recognised trace kind and does not return 404", async () => {
    const res = await get("/api/repos/o/r/trace/callers?symbol=nextTransition");
    expect(res.statusCode).not.toBe(404);
  });
});
