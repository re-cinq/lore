import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { buildServer } from "../../app/build-server.js";
import {
  makePool,
  useRateLimitSafeClock,
  AUTH,
  LEGACY_TOKEN,
} from "@re-cinq/lore-server-core/test-helpers/http-mock.js";

const originalEnv = { ...process.env };
const get = (pool: unknown, url: string) =>
  buildServer(() => pool as any).inject({ method: "GET", url, headers: AUTH });

describe("Blocked-reason read routes", () => {
  useRateLimitSafeClock();
  beforeEach(() => {
    process.env.LORE_INGEST_TOKEN = LEGACY_TOKEN;
  });
  afterEach(() => {
    process.env = { ...originalEnv };
    vi.clearAllMocks();
  });

  describe("GET /api/repos/{owner}/{repo}/pulls/{number}/blocked-reason", () => {
    it("answers the PR blocked reason when a reason exists", async () => {
      const pool = makePool();

      pool.query.mockResolvedValue({
        rows: [
          {
            repo: "re-cinq/lore",
            pr_number: 123,
            reason: "waiting_on_ci",
            detail: null,
            since: "2026-10-13T00:00:00.000Z",
            updated_at: "2026-10-13T00:00:00.000Z",
          },
        ],
      });

      const res = await get(
        pool,
        "/api/repos/re-cinq/lore/pulls/123/blocked-reason",
      );

      expect(res.statusCode).toBe(200);
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining("pipeline.pr_blocked_reasons"),
        expect.arrayContaining(["re-cinq/lore", 123]),
      );
      expect(res.result).toEqual({
        repo: "re-cinq/lore",
        prNumber: 123,
        reason: "waiting_on_ci",
        label: "Waiting for CI",
        detail: null,
        since: "2026-10-13T00:00:00.000Z",
        updatedAt: "2026-10-13T00:00:00.000Z",
      });
    });

    it("answers with reason null when nothing blocks it", async () => {
      const pool = makePool();

      pool.query.mockResolvedValue({
        rows: [],
      });

      const res = await get(
        pool,
        "/api/repos/re-cinq/lore/pulls/123/blocked-reason",
      );

      expect(res.statusCode).toBe(200);
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining("pipeline.pr_blocked_reasons"),
        expect.arrayContaining(["re-cinq/lore", 123]),
      );
      expect(res.result).toEqual({
        repo: "re-cinq/lore",
        prNumber: 123,
        reason: null,
        label: null,
        detail: null,
        since: null,
        updatedAt: null,
      });
    });
  });

  describe("GET /api/repos/{owner}/{repo}/blocked-pulls", () => {
    it("answers blocked PRs only in the pulls array", async () => {
      const pool = makePool();

      pool.query.mockResolvedValue({
        rows: [
          {
            repo: "re-cinq/lore",
            pr_number: 124,
            reason: "needs_approval",
            detail: null,
            since: "2026-10-13T00:00:00.000Z",
            updated_at: "2026-10-13T00:00:00.000Z",
          },
        ],
      });

      const res = await get(pool, "/api/repos/re-cinq/lore/blocked-pulls");

      expect(res.statusCode).toBe(200);
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining("reason IS NOT NULL"),
        expect.arrayContaining(["re-cinq/lore"]),
      );
      expect(res.result).toEqual({
        pulls: [
          {
            repo: "re-cinq/lore",
            prNumber: 124,
            reason: "needs_approval",
            label: "Needs one approval",
            detail: null,
            since: "2026-10-13T00:00:00.000Z",
            updatedAt: "2026-10-13T00:00:00.000Z",
          },
        ],
      });
    });

    it("answers an empty pulls array when no PR is blocked", async () => {
      const pool = makePool();

      pool.query.mockResolvedValue({ rows: [] });

      const res = await get(pool, "/api/repos/re-cinq/lore/blocked-pulls");

      expect(res.result).toEqual({ pulls: [] });
    });

    it("leaves out PRs whose closed_at is set", async () => {
      const pool = makePool();

      pool.query.mockResolvedValue({ rows: [] });

      await get(pool, "/api/repos/re-cinq/lore/blocked-pulls");

      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining("closed_at IS NULL"),
        ["re-cinq/lore"],
      );
    });
  });
});
