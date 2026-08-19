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
      turnRows: Array<{ id: string }>,
      task?: Record<string, unknown>,
    ) => {
      const pool = makePool();

      pool.query.mockImplementation((sql: string, params?: unknown[]) => {
        if (!sql.includes("agent_run_turns")) {
          return Promise.resolve({ rows: task ? [task] : [] });
        }
        const [, afterId, limit] = params as [string, string, number];
        const page = turnRows
          .filter((row) => BigInt(row.id) > BigInt(afterId))
          .slice(0, limit);

        return Promise.resolve({ rows: page });
      });

      return pool;
    };
    const turnRow = (
      id: number | string,
      envelope: Record<string, unknown>,
    ) => ({
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
        cursor: `t:2:${logs.length}`,
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
        cursor: `t:2:${flat.length}`,
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
    it("pages the cursor across a transcript larger than one page", async () => {
      const envelope = { event: { type: "assistant" } };
      const rows = Array.from({ length: 2500 }, (_, i) =>
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
      const line = `${JSON.stringify(envelope)}\n`;

      expect(res.result).toEqual({
        logs: line.repeat(2500),
        next_offset: line.length * 2500,
        complete: true,
        cursor: `t:2500:${line.length * 2500}`,
      });
      expect(pool.query).toHaveBeenCalledTimes(4);
    });
    it("returns complete true for turns whose task row is gone", async () => {
      const pool = poolWithTurns([turnRow(1, { event: { type: "result" } })]);
      const res = await inject(
        { method: "GET", url: "/api/task-logs?task_id=t" },
        pool,
      );

      expect(res.result).toMatchObject({ complete: true });
    });
    it("returns complete false for a GCS hit while the local task still runs", async () => {
      storage.file.exists.mockResolvedValue([true]);
      storage.file.download.mockResolvedValue([Buffer.from("hello")]);
      const pool = poolWithTurns([], {
        target_repo: "o/r",
        status: "running-local",
      });
      const res = await inject(
        { method: "GET", url: "/api/task-logs?task_id=t" },
        pool,
      );

      expect(res.result).toEqual({
        logs: "hello",
        next_offset: 5,
        complete: false,
      });
    });
    const get = (pool: unknown, offset: number, cursor?: string) =>
      inject(
        {
          method: "GET",
          url: `/api/task-logs?task_id=t&offset=${offset}${cursor === undefined ? "" : `&cursor=${encodeURIComponent(cursor)}`}`,
        },
        pool,
      );
    const turnQueryAfterIds = (pool: ReturnType<typeof makePool>) =>
      (pool.query.mock.calls as Array<[string, unknown[]]>)
        .filter(([sql]) => sql.includes("agent_run_turns"))
        .map(([, params]) => params[1]);

    type SliceBody = {
      logs: string;
      next_offset: number;
      complete: boolean;
      cursor: string;
    };

    it("resumes from the returned cursor without re-reading the prefix", async () => {
      const envelope = { event: { type: "assistant", text: "x".repeat(280) } };
      const rows = Array.from({ length: 1000 }, (_, i) =>
        turnRow(i + 1, envelope),
      );
      const pool = poolWithTurns(rows, {
        target_repo: "o/r",
        status: "completed",
      });
      const first = await get(pool, 0);
      const firstBody = first.result as SliceBody;
      const line = `${JSON.stringify(envelope)}\n`;
      const fullRows = Math.floor(LOG_SLICE_MAX / line.length);

      expect(firstBody.cursor).toBe(`t:${fullRows}:${fullRows * line.length}`);
      pool.query.mockClear();
      const second = await get(pool, firstBody.next_offset, firstBody.cursor);
      const secondBody = second.result as SliceBody;

      expect(firstBody.logs + secondBody.logs).toBe(line.repeat(1000));
      expect(secondBody).toMatchObject({
        next_offset: line.length * 1000,
        complete: true,
        cursor: `t:1000:${line.length * 1000}`,
      });
      expect(turnQueryAfterIds(pool)).toEqual([String(fullRows)]);
    });
    it("mints the cursor at the row boundary when the cap lands exactly on it", async () => {
      const base = JSON.stringify({
        event: { type: "assistant", text: "" },
      }).length;
      const envelope = {
        event: { type: "assistant", text: "y".repeat(255 - base) },
      };
      const line = `${JSON.stringify(envelope)}\n`;

      expect(line.length).toBe(256);
      const rows = Array.from({ length: 1025 }, (_, i) =>
        turnRow(i + 1, envelope),
      );
      const pool = poolWithTurns(rows, {
        target_repo: "o/r",
        status: "completed",
      });
      const first = await get(pool, 0);
      const firstBody = first.result as SliceBody;

      expect(firstBody).toMatchObject({
        next_offset: LOG_SLICE_MAX,
        complete: false,
        cursor: `t:1024:${LOG_SLICE_MAX}`,
      });
      pool.query.mockClear();
      const second = await get(pool, LOG_SLICE_MAX, firstBody.cursor);

      expect(second.result).toEqual({
        logs: line,
        next_offset: LOG_SLICE_MAX + line.length,
        complete: true,
        cursor: `t:1025:${LOG_SLICE_MAX + line.length}`,
      });
      expect(turnQueryAfterIds(pool)).toEqual(["1024"]);
    });
    it("echoes the cursor unchanged when no new rows arrived", async () => {
      const envelope = { event: { type: "assistant" } };
      const line = `${JSON.stringify(envelope)}\n`;
      const pool = poolWithTurns([turnRow(1, envelope), turnRow(2, envelope)], {
        target_repo: "o/r",
        status: "running",
      });
      const first = await get(pool, 0);

      expect(first.result).toEqual({
        logs: line.repeat(2),
        next_offset: line.length * 2,
        complete: false,
        cursor: `t:2:${line.length * 2}`,
      });
      const second = await get(pool, line.length * 2, `t:2:${line.length * 2}`);

      expect(second.result).toEqual({
        logs: "",
        next_offset: line.length * 2,
        complete: false,
        cursor: `t:2:${line.length * 2}`,
      });
      expect(storage.file.exists).not.toHaveBeenCalled();
    });
    it("ignores a cursor minted for a different task", async () => {
      const envelope = { event: { type: "assistant" } };
      const line = `${JSON.stringify(envelope)}\n`;
      const pool = poolWithTurns([turnRow(1, envelope), turnRow(2, envelope)], {
        target_repo: "o/r",
        status: "completed",
      });
      const res = await get(pool, line.length, `u:1:${line.length}`);

      expect(res.result).toEqual({
        logs: line,
        next_offset: line.length * 2,
        complete: true,
        cursor: `t:2:${line.length * 2}`,
      });
      expect(turnQueryAfterIds(pool)).toEqual(["0"]);
    });
    it("ignores a garbage cursor", async () => {
      const envelope = { event: { type: "assistant" } };
      const line = `${JSON.stringify(envelope)}\n`;
      const pool = poolWithTurns([turnRow(1, envelope), turnRow(2, envelope)], {
        target_repo: "o/r",
        status: "completed",
      });
      const res = await get(pool, line.length, "not-a-cursor");

      expect(res.result).toEqual({
        logs: line,
        next_offset: line.length * 2,
        complete: true,
        cursor: `t:2:${line.length * 2}`,
      });
      expect(turnQueryAfterIds(pool)).toEqual(["0"]);
    });
    it("ignores a cursor whose char count exceeds the offset", async () => {
      const envelope = { event: { type: "assistant" } };
      const line = `${JSON.stringify(envelope)}\n`;
      const pool = poolWithTurns([turnRow(1, envelope), turnRow(2, envelope)], {
        target_repo: "o/r",
        status: "completed",
      });
      const res = await get(pool, line.length, `t:2:${line.length * 2}`);

      expect(res.result).toEqual({
        logs: line,
        next_offset: line.length * 2,
        complete: true,
        cursor: `t:2:${line.length * 2}`,
      });
      expect(turnQueryAfterIds(pool)).toEqual(["0"]);
    });
    it("ignores any cursor at offset zero", async () => {
      const envelope = { event: { type: "assistant" } };
      const line = `${JSON.stringify(envelope)}\n`;
      const pool = poolWithTurns([turnRow(1, envelope), turnRow(2, envelope)], {
        target_repo: "o/r",
        status: "completed",
      });
      const res = await get(pool, 0, "t:1:0");

      expect(res.result).toEqual({
        logs: line.repeat(2),
        next_offset: line.length * 2,
        complete: true,
        cursor: `t:2:${line.length * 2}`,
      });
      expect(turnQueryAfterIds(pool)).toEqual(["0"]);
    });
    it("rescans when the offset is not inside the first resumed row", async () => {
      const envelope = { event: { type: "assistant" } };
      const line = `${JSON.stringify(envelope)}\n`;
      const pool = poolWithTurns(
        [turnRow(1, envelope), turnRow(2, envelope), turnRow(3, envelope)],
        { target_repo: "o/r", status: "completed" },
      );
      const res = await get(pool, line.length * 3, `t:1:${line.length}`);

      expect(res.result).toEqual({
        logs: "",
        next_offset: line.length * 3,
        complete: true,
        cursor: `t:3:${line.length * 3}`,
      });
      expect(turnQueryAfterIds(pool)).toEqual(["1", "0"]);
    });
    it("rescans when the cursor points past every stored row", async () => {
      const envelope = { event: { type: "assistant" } };
      const line = `${JSON.stringify(envelope)}\n`;
      const pool = poolWithTurns([turnRow(1, envelope), turnRow(2, envelope)], {
        target_repo: "o/r",
        status: "completed",
      });
      const res = await get(pool, line.length * 2, `t:9:${line.length}`);

      expect(res.result).toEqual({
        logs: "",
        next_offset: line.length * 2,
        complete: true,
        cursor: `t:2:${line.length * 2}`,
      });
      expect(turnQueryAfterIds(pool)).toEqual(["9", "0"]);
    });
    it("round-trips row ids past the max safe integer without narrowing", async () => {
      const envelope = { event: { type: "assistant" } };
      const line = `${JSON.stringify(envelope)}\n`;
      const pool = poolWithTurns(
        [
          turnRow("9007199254740993", envelope),
          turnRow("9007199254740995", envelope),
        ],
        { target_repo: "o/r", status: "running" },
      );
      const first = await get(pool, 0);

      expect(first.result).toMatchObject({
        cursor: `t:9007199254740995:${line.length * 2}`,
      });
      const second = await get(
        pool,
        line.length * 2,
        `t:9007199254740995:${line.length * 2}`,
      );

      expect(second.result).toEqual({
        logs: "",
        next_offset: line.length * 2,
        complete: false,
        cursor: `t:9007199254740995:${line.length * 2}`,
      });
    });
    it("rejects a cursor whose row id exceeds the PG bigint range", async () => {
      const envelope = { event: { type: "assistant" } };
      const line = `${JSON.stringify(envelope)}\n`;
      const pool = poolWithTurns([turnRow(1, envelope), turnRow(2, envelope)], {
        target_repo: "o/r",
        status: "completed",
      });
      const res = await get(pool, line.length, "t:99999999999999999999:1");

      expect(res.result).toEqual({
        logs: line,
        next_offset: line.length * 2,
        complete: true,
        cursor: `t:2:${line.length * 2}`,
      });
      expect(turnQueryAfterIds(pool)).toEqual(["0"]);
    });
  });
});
