import { describe, it, expect, vi, afterEach } from "vitest";
import { createServer } from "node:http";
import { getHealthStatus, setPool } from "../db.js";

// ── Unit tests for getHealthStatus ─────────────────────────────────────────

describe("getHealthStatus", () => {
  afterEach(() => {
    setPool(null as any);
  });

  it("returns connected=false when no pool is configured", async () => {
    setPool(null as any);
    const result = await getHealthStatus();
    expect(result.connected).toBe(false);
    expect(result.chunk_count).toBeNull();
  });

  it("returns connected=true when pool query succeeds", async () => {
    const mockPool = {
      query: vi.fn().mockImplementation((sql: string) => {
        if (sql === "SELECT 1") return Promise.resolve({});
        return Promise.resolve({ rows: [{ cnt: 42 }] });
      }),
    };
    setPool(mockPool as any);
    const result = await getHealthStatus();
    expect(result.connected).toBe(true);
    expect(result.chunk_count).toBe(42);
  });

  it("returns connected=false when pool query throws", async () => {
    const mockPool = {
      query: vi.fn().mockRejectedValue(new Error("connection refused")),
    };
    setPool(mockPool as any);
    const result = await getHealthStatus();
    expect(result.connected).toBe(false);
    expect(result.reason).toBeDefined();
  });
});

// ── HTTP /healthz handler logic ─────────────────────────────────────────────

describe("/healthz endpoint", () => {
  afterEach(() => {
    setPool(null as any);
    delete process.env.LORE_DB_HOST;
  });

  it("returns 200 with status=ok when no DB configured", async () => {
    delete process.env.LORE_DB_HOST;
    setPool(null as any);

    const health = await getHealthStatus();
    const status = health.connected || !process.env.LORE_DB_HOST ? "ok" : "error";
    const code = status === "error" ? 503 : 200;

    expect(code).toBe(200);
    expect(status).toBe("ok");
  });

  it("returns 200 with status=ok when DB is connected", async () => {
    process.env.LORE_DB_HOST = "localhost";
    const mockPool = {
      query: vi.fn().mockImplementation((sql: string) => {
        if (sql === "SELECT 1") return Promise.resolve({});
        return Promise.resolve({ rows: [{ cnt: 0 }] });
      }),
    };
    setPool(mockPool as any);

    const health = await getHealthStatus();
    const status = health.connected || !process.env.LORE_DB_HOST ? "ok" : "error";
    const code = status === "error" ? 503 : 200;

    expect(code).toBe(200);
    expect(status).toBe("ok");
  });

  it("returns 503 with status=error when DB is configured but unreachable", async () => {
    process.env.LORE_DB_HOST = "localhost";
    const mockPool = {
      query: vi.fn().mockRejectedValue(new Error("ECONNREFUSED")),
    };
    setPool(mockPool as any);

    const health = await getHealthStatus();
    const status = health.connected || !process.env.LORE_DB_HOST ? "ok" : "error";
    const code = status === "error" ? 503 : 200;

    expect(code).toBe(503);
    expect(status).toBe("error");
  });
});
