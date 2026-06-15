import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { handleApiRoute } from "../routes.js";
import { makeReq, makeRes, useRateLimitSafeClock, AUTH, LEGACY_TOKEN } from "../../test-helpers/http-mock.js";

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
    it("returns 400 when fields are missing", async () => {
      const res = makeRes();
      await handleApiRoute(makeReq({ url: "/api/task-logs", method: "POST", headers: AUTH, body: { task_id: "t" } }), res, null);
      expect(res.statusCode).toBe(400);
    });
    it("saves logs to storage", async () => {
      storage.file.save.mockResolvedValue(undefined);
      const res = makeRes();
      await handleApiRoute(makeReq({ url: "/api/task-logs", method: "POST", headers: AUTH, body: { task_id: "t", repo: "o/r", logs: "x" } }), res, null);
      expect(res.json).toEqual({ ok: true });
      expect(storage.file.save).toHaveBeenCalled();
    });
    it("returns 500 when storage throws", async () => {
      storage.file.save.mockRejectedValue(new Error("gcs"));
      const res = makeRes();
      await handleApiRoute(makeReq({ url: "/api/task-logs", method: "POST", headers: AUTH, body: { task_id: "t", repo: "o/r", logs: "x" } }), res, null);
      expect(res.statusCode).toBe(500);
    });
  });

  describe("GET", () => {
    it("returns 400 when task_id or repo missing", async () => {
      const res = makeRes();
      await handleApiRoute(makeReq({ url: "/api/task-logs?task_id=t", headers: AUTH }), res, null);
      expect(res.statusCode).toBe(400);
    });
    it("returns empty when the log file does not exist", async () => {
      storage.file.exists.mockResolvedValue([false]);
      const res = makeRes();
      await handleApiRoute(makeReq({ url: "/api/task-logs?task_id=t&repo=o/r", headers: AUTH }), res, null);
      expect(res.json).toEqual({ logs: "", next_offset: 0, complete: true });
    });
    it("returns a slice from offset when the file exists", async () => {
      storage.file.exists.mockResolvedValue([true]);
      storage.file.download.mockResolvedValue([Buffer.from("hello world")]);
      const res = makeRes();
      await handleApiRoute(makeReq({ url: "/api/task-logs?task_id=t&repo=o/r&offset=6", headers: AUTH }), res, null);
      expect(res.json).toEqual({ logs: "world", next_offset: 11, complete: true });
    });
    it("returns 500 when storage throws", async () => {
      storage.file.exists.mockRejectedValue(new Error("gcs"));
      const res = makeRes();
      await handleApiRoute(makeReq({ url: "/api/task-logs?task_id=t&repo=o/r", headers: AUTH }), res, null);
      expect(res.statusCode).toBe(500);
    });
  });
});
