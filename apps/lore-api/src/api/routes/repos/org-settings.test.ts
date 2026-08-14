import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const fakeSettings = { record: vi.fn(), rawSettings: vi.fn() };

vi.mock("../../../platform/project-boot.js", () => ({
  projectFor: vi.fn(async () => ({ settings: fakeSettings })),
}));

import { buildServer } from "../../../server/build-server.js";
import {
  makePool,
  useRateLimitSafeClock,
  AUTH,
  LEGACY_TOKEN,
} from "@re-cinq/lore-server-core/test-helpers/http-mock.js";

const originalEnv = { ...process.env };

describe("org settings + repo sessions", () => {
  useRateLimitSafeClock();
  beforeEach(() => {
    process.env.LORE_INGEST_TOKEN = LEGACY_TOKEN;
  });
  afterEach(() => {
    process.env = { ...originalEnv };
    vi.clearAllMocks();
  });

  function call(
    method: string,
    url: string,
    payload?: unknown,
    pool: unknown = makePool(),
  ) {
    return buildServer(() => pool as never).inject({
      method,
      url,
      headers: AUTH,
      ...(payload === undefined ? {} : { payload: JSON.stringify(payload) }),
    });
  }

  describe("GET /api/settings", () => {
    it("returns 503 when pool is null", async () => {
      expect(
        (await call("GET", "/api/settings", undefined, null)).statusCode,
      ).toBe(503);
    });

    it("returns the org settings and the repo count", async () => {
      const pool = makePool();

      pool.query
        .mockResolvedValueOnce({
          rows: [{ key: "api_url", value: "https://x" }],
        })
        .mockResolvedValueOnce({ rows: [{ count: 8 }] });

      expect(
        (await call("GET", "/api/settings", undefined, pool)).result,
      ).toEqual({
        settings: [{ key: "api_url", value: "https://x" }],
        repo_count: 8,
      });
    });
  });

  describe("PUT /api/settings", () => {
    it("upserts each entry by key", async () => {
      const pool = makePool();

      pool.query.mockResolvedValue({ rows: [] });
      const res = await call(
        "PUT",
        "/api/settings",
        { entries: [{ key: "api_url", value: "https://x" }] },
        pool,
      );

      expect(res.statusCode).toBe(200);
      expect(pool.query.mock.calls[0][0]).toContain("ON CONFLICT (key)");
      expect(pool.query.mock.calls[0][1]).toEqual(["api_url", "https://x"]);
    });

    it("writes nothing for a blank value rather than erasing the setting", async () => {
      const pool = makePool();

      pool.query.mockResolvedValue({ rows: [] });
      await call(
        "PUT",
        "/api/settings",
        { entries: [{ key: "api_url", value: "   " }] },
        pool,
      );

      expect(pool.query).not.toHaveBeenCalled();
    });

    it("refuses an unknown key", async () => {
      const res = await call("PUT", "/api/settings", {
        entries: [{ key: "not_a_setting", value: "x" }],
      });

      expect(res.statusCode).toBe(400);
    });
  });

  describe("GET /api/repos/{owner}/{repo}/sessions", () => {
    it("returns the developer count and the last session stamp", async () => {
      const pool = makePool();

      pool.query.mockResolvedValue({ rows: [{ devs: 3, last: "2026-08-01" }] });

      expect(
        (await call("GET", "/api/repos/re-cinq/lore/sessions", undefined, pool))
          .result,
      ).toEqual({ devs: 3, last: "2026-08-01" });
    });

    it("answers zero developers rather than failing when nothing has run", async () => {
      const pool = makePool();

      pool.query.mockResolvedValue({ rows: [] });

      expect(
        (await call("GET", "/api/repos/re-cinq/lore/sessions", undefined, pool))
          .result,
      ).toEqual({ devs: 0, last: null });
    });
  });
});
