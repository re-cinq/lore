import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { buildServer } from "../../../server/build-server.js";
import {
  makePool,
  useRateLimitSafeClock,
  AUTH,
  LEGACY_TOKEN,
} from "@re-cinq/lore-server-core/test-helpers/http-mock.js";

const TASK_SCOPED = { authorization: "Bearer task-only" };

const storage = vi.hoisted(() => {
  const file = { save: vi.fn(), exists: vi.fn(), download: vi.fn() };
  const bucketObj = { file: vi.fn(() => file) };

  class Storage {
    bucket() {
      return bucketObj;
    }
  }

  return { file, Storage };
});

vi.mock("@google-cloud/storage", () => ({ Storage: storage.Storage }));

const originalEnv = { ...process.env };
const inject = (
  opts: { method: "GET" | "POST"; url: string; payload?: string },
  pool: unknown = null,
  headers: Record<string, string> = AUTH,
) => buildServer(() => pool as any).inject({ ...opts, headers });

describe("/api/task-logs", () => {
  useRateLimitSafeClock();
  beforeEach(() => {
    process.env.LORE_INGEST_TOKEN = LEGACY_TOKEN;
  });
  afterEach(() => {
    process.env = { ...originalEnv };
    vi.clearAllMocks();
  });

  describe("POST", () => {
    const post = (body: Record<string, unknown>) =>
      inject({
        method: "POST",
        url: "/api/task-logs",
        payload: JSON.stringify(body),
      });

    it("returns 400 when fields are missing", async () => {
      const res = await post({ task_id: "t" });

      expect(res.statusCode).toBe(400);
    });
    it("saves logs to storage", async () => {
      storage.file.save.mockResolvedValue(undefined);
      const res = await post({ task_id: "t", repo: "o/r", logs: "x" });

      expect(res.result).toEqual({ ok: true });
      expect(storage.file.save).toHaveBeenCalled();
    });
    it("returns 500 when storage throws", async () => {
      storage.file.save.mockRejectedValue(new Error("gcs"));
      const res = await post({ task_id: "t", repo: "o/r", logs: "x" });

      expect(res.statusCode).toBe(500);
    });
    it("returns 403 when the token has task scope but not write", async () => {
      const pool = makePool();

      pool.query.mockResolvedValue({ rows: [{ scopes: ["task"] }] });
      const res = await inject(
        {
          method: "POST",
          url: "/api/task-logs",
          payload: JSON.stringify({ task_id: "t", repo: "o/r", logs: "x" }),
        },
        pool,
        TASK_SCOPED,
      );

      expect(res.statusCode).toBe(403);
      expect(JSON.parse(res.payload)).toEqual({ error: "insufficient scope" });
    });
  });

  describe("GET", () => {
    it("returns 400 when task_id is missing", async () => {
      const res = await inject({
        method: "GET",
        url: "/api/task-logs?repo=o/r",
      });

      expect(res.statusCode).toBe(400);
    });
    it("returns 503 when repo is omitted and no pool resolves it", async () => {
      const res = await inject({
        method: "GET",
        url: "/api/task-logs?task_id=t",
      });

      expect(res.statusCode).toBe(503);
    });
    it("resolves repo from task_id when repo is omitted", async () => {
      storage.file.exists.mockResolvedValue([false]);
      const pool = makePool();

      pool.query.mockResolvedValue({ rows: [{ target_repo: "o/r" }] });
      const res = await inject(
        { method: "GET", url: "/api/task-logs?task_id=t" },
        pool,
      );

      expect(res.result).toEqual({ logs: "", next_offset: 0, complete: false });
    });
    it("returns empty and incomplete when the log file does not exist", async () => {
      storage.file.exists.mockResolvedValue([false]);
      const res = await inject({
        method: "GET",
        url: "/api/task-logs?task_id=t&repo=o/r",
      });

      expect(res.result).toEqual({ logs: "", next_offset: 0, complete: false });
    });
    it("returns a slice from offset when the file exists", async () => {
      storage.file.exists.mockResolvedValue([true]);
      storage.file.download.mockResolvedValue([Buffer.from("hello world")]);
      const res = await inject({
        method: "GET",
        url: "/api/task-logs?task_id=t&repo=o/r&offset=6",
      });

      expect(res.result).toEqual({
        logs: "world",
        next_offset: 11,
        complete: true,
      });
    });
    it("returns 500 when storage throws", async () => {
      storage.file.exists.mockRejectedValue(new Error("gcs"));
      const res = await inject({
        method: "GET",
        url: "/api/task-logs?task_id=t&repo=o/r",
      });

      expect(res.statusCode).toBe(500);
    });
    it("returns 403 when the token has task scope but not write", async () => {
      const pool = makePool();

      pool.query.mockResolvedValue({ rows: [{ scopes: ["task"] }] });
      const res = await inject(
        { method: "GET", url: "/api/task-logs?task_id=t&repo=o/r" },
        pool,
        TASK_SCOPED,
      );

      expect(res.statusCode).toBe(403);
      expect(JSON.parse(res.payload)).toEqual({ error: "insufficient scope" });
    });
  });
});
