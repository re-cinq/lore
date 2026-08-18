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
    const LOG_SLICE_MAX = 256 * 1024;
    const poolWithTurns = (
      turnRows: Array<Record<string, unknown>>,
      task?: Record<string, unknown>,
    ) => {
      const pool = makePool();

      pool.query.mockImplementation((sql: string) =>
        sql.includes("agent_run_turns")
          ? Promise.resolve({ rows: turnRows })
          : Promise.resolve({ rows: task ? [task] : [] }),
      );

      return pool;
    };
    const turnRow = (id: number, envelope: Record<string, unknown>) => ({
      id: String(id),
      task_id: "t",
      agent_cr_name: null,
      assembly_line_id: null,
      station_run_id: null,
      node_id: null,
      iteration: null,
      event_type: null,
      envelope,
      created_at: new Date(),
    });

    it("resolves repo from task_id when repo is omitted", async () => {
      storage.file.exists.mockResolvedValue([false]);
      const pool = poolWithTurns([], { target_repo: "o/r", status: "running" });
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
    it("returns flattened turn envelopes with complete true when the task is finished", async () => {
      const first = { source: { task: "t" }, event: { type: "assistant" } };
      const second = { source: { task: "t" }, event: { type: "result" } };
      const pool = poolWithTurns([turnRow(1, first), turnRow(2, second)], {
        target_repo: "o/r",
        status: "completed",
      });
      const res = await inject(
        { method: "GET", url: "/api/task-logs?task_id=t" },
        pool,
      );
      const logs = `${JSON.stringify(first)}\n${JSON.stringify(second)}\n`;

      expect(res.result).toEqual({
        logs,
        next_offset: logs.length,
        complete: true,
      });
      expect(storage.file.exists).not.toHaveBeenCalled();
    });
    it("returns complete false for turns of a task still running", async () => {
      const pool = poolWithTurns(
        [turnRow(1, { event: { type: "assistant" } })],
        { target_repo: "o/r", status: "running" },
      );
      const res = await inject(
        { method: "GET", url: "/api/task-logs?task_id=t" },
        pool,
      );

      expect(res.result).toMatchObject({ complete: false });
    });
    it("returns the slice from offset into the flattened transcript", async () => {
      const first = { event: { type: "assistant", text: "one" } };
      const second = { event: { type: "result", text: "two" } };
      const pool = poolWithTurns([turnRow(1, first), turnRow(2, second)], {
        target_repo: "o/r",
        status: "completed",
      });
      const flat = `${JSON.stringify(first)}\n${JSON.stringify(second)}\n`;
      const offset = JSON.stringify(first).length + 4;
      const res = await inject(
        { method: "GET", url: `/api/task-logs?task_id=t&offset=${offset}` },
        pool,
      );

      expect(res.result).toEqual({
        logs: flat.substring(offset),
        next_offset: flat.length,
        complete: true,
      });
    });
    it("caps the slice at LOG_SLICE_MAX and stops fetching further pages", async () => {
      const envelope = { event: { type: "assistant", text: "x".repeat(280) } };
      const rows = Array.from({ length: 1000 }, (_, i) =>
        turnRow(i + 1, envelope),
      );
      const pool = poolWithTurns(rows, {
        target_repo: "o/r",
        status: "completed",
      });
      const res = await inject(
        { method: "GET", url: "/api/task-logs?task_id=t" },
        pool,
      );
      const body = res.result as {
        logs: string;
        next_offset: number;
        complete: boolean;
      };

      expect(body.logs.length).toBe(LOG_SLICE_MAX);
      expect(body).toMatchObject({
        next_offset: LOG_SLICE_MAX,
        complete: false,
      });
      expect(pool.query).toHaveBeenCalledTimes(2);
    });
    it("falls back to GCS with complete true when a finished task has no turns", async () => {
      storage.file.exists.mockResolvedValue([false]);
      const pool = poolWithTurns([], {
        target_repo: "o/r",
        status: "completed",
      });
      const res = await inject(
        { method: "GET", url: "/api/task-logs?task_id=t" },
        pool,
      );

      expect(res.result).toEqual({ logs: "", next_offset: 0, complete: true });
    });
  });
});
