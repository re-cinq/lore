import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { buildServer } from "../../../server/build-server.js";
import { useRateLimitSafeClock, AUTH, LEGACY_TOKEN } from "@re-cinq/lore-server-core/test-helpers/http-mock.js";

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
const get = (url: string) => buildServer(() => null).inject({ method: "GET", url, headers: AUTH });

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
    const res = await get("/api/job-run-logs?job_name=j");
    expect(res.statusCode).toBe(400);
  });

  it("returns empty and incomplete when the file does not exist", async () => {
    storage.file.exists.mockResolvedValue([false]);
    const res = await get("/api/job-run-logs?job_name=j&run_id=r");
    expect(res.result).toEqual({ logs: "", complete: false });
  });

  it("returns the file content when it exists", async () => {
    storage.file.exists.mockResolvedValue([true]);
    storage.file.download.mockResolvedValue([Buffer.from("job output")]);
    const res = await get("/api/job-run-logs?job_name=j&run_id=r");
    expect(res.result).toEqual({ logs: "job output", complete: true });
  });

  it("returns 500 when storage throws", async () => {
    storage.file.exists.mockRejectedValue(new Error("gcs"));
    const res = await get("/api/job-run-logs?job_name=j&run_id=r");
    expect(res.statusCode).toBe(500);
  });
});
