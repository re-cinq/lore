import { describe, it, expect, beforeEach } from "vitest";
import { buildServer } from "../../../app/build-server.js";
import {
  makePool,
  useRateLimitSafeClock,
  AUTH,
  LEGACY_TOKEN,
} from "@re-cinq/lore-server-core/test-helpers/http-mock.js";

const get = (url: string) =>
  buildServer(() => makePool() as never).inject({
    method: "GET",
    url,
    headers: AUTH,
  });

describe("GET /api/repos/:owner/:repo/trace/callers", () => {
  useRateLimitSafeClock();
  beforeEach(() => {
    process.env.LORE_INGEST_TOKEN = LEGACY_TOKEN;
  });

  it("refuses depth > 1 with a 400 that says one hop is supported", async () => {
    const res = await get(
      "/api/repos/foo/bar/trace/callers?symbol=foo&depth=2",
    );

    expect(res.statusCode).toBe(400);
    const body = res.json();

    expect(body.message).toContain("one hop is supported");
  });
});
