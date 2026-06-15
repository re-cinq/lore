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

describe("GET /api/job-run-logs", () => {
  useRateLimitSafeClock();
  beforeEach(() => {
    process.env.LORE_INGEST_TOKEN = LEGACY_TOKEN;
  });
  afterEach(() => {
    process.env = { ...originalEnv };
    vi.clearAllMocks();
  });

  it("returns 400 when params missing", async () => {
    const res = makeRes();
    await handleApiRoute(makeReq({ url: "/api/job-run-logs?job_name=j", headers: AUTH }), res, null);
    expect(res.statusCode).toBe(400);
  });
  it("returns empty when the file does not exist", async () => {
    storage.file.exists.mockResolvedValue([false]);
    const res = makeRes();
    await handleApiRoute(makeReq({ url: "/api/job-run-logs?job_name=j&run_id=r", headers: AUTH }), res, null);
    expect(res.json).toEqual({ logs: "", complete: true });
  });
  it("returns the file content when it exists", async () => {
    storage.file.exists.mockResolvedValue([true]);
    storage.file.download.mockResolvedValue([Buffer.from("job output")]);
    const res = makeRes();
    await handleApiRoute(makeReq({ url: "/api/job-run-logs?job_name=j&run_id=r", headers: AUTH }), res, null);
    expect(res.json).toEqual({ logs: "job output", complete: true });
  });
  it("returns 500 when storage throws", async () => {
    storage.file.exists.mockRejectedValue(new Error("gcs"));
    const res = makeRes();
    await handleApiRoute(makeReq({ url: "/api/job-run-logs?job_name=j&run_id=r", headers: AUTH }), res, null);
    expect(res.statusCode).toBe(500);
  });
});
