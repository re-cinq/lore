import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { buildServer } from "../../../app/build-server.js";

vi.mock("@re-cinq/lore-server-core/platform/db.js", () => ({
  getHealthStatus: vi.fn(),
  isDbAvailable: vi.fn(),
  getQueryEmbedding: vi.fn(),
  embeddingHealth: vi.fn(),
  embedderDegraded: vi.fn(),
}));

import {
  getHealthStatus,
  embeddingHealth,
  embedderDegraded,
} from "@re-cinq/lore-server-core/platform/db.js";

const originalEnv = { ...process.env };
const inject = (pool: unknown) =>
  buildServer(() => pool as any).inject({
    method: "GET",
    url: "/healthz",
  });

describe("GET /healthz acceptance", () => {
  beforeEach(() => {
    delete process.env.LORE_DB_HOST;
    vi.mocked(embeddingHealth).mockReturnValue({
      lastOkAt: "2026-09-09T10:00:00.000Z",
      lastFailureAt: null,
      lastStatus: null,
      consecutiveFailures: 0,
    });
    vi.mocked(embedderDegraded).mockReturnValue(false);
  });
  afterEach(() => {
    process.env = { ...originalEnv };
    vi.clearAllMocks();
  });

  it("returns 503 error with reason when configured DB is unreachable", async () => {
    process.env.LORE_DB_HOST = "db.internal";
    vi.mocked(getHealthStatus).mockResolvedValue({
      connected: false,
      chunk_count: null,
      reason: "connection failed",
    });

    const res = await inject(null);

    expect(res.statusCode).toBe(503);
    expect(res.result).toEqual({
      status: "error",
      reason: "connection failed",
    });
  });

  it("returns 200 ok when DB is connected", async () => {
    process.env.LORE_DB_HOST = "db.internal";
    vi.mocked(getHealthStatus).mockResolvedValue({
      connected: true,
      chunk_count: 5,
    } as any);

    const res = await inject(null);

    expect(res.statusCode).toBe(200);
    expect(res.result).toEqual({ status: "ok" });
  });

  it("returns 200 ok when no DB is configured", async () => {
    delete process.env.LORE_DB_HOST;
    vi.mocked(getHealthStatus).mockResolvedValue({
      connected: false,
      reason: "No database configured",
      chunk_count: null,
    } as any);

    const res = await inject(null);

    expect(res.statusCode).toBe(200);
    expect(res.result).toEqual({ status: "ok" });
  });
});
