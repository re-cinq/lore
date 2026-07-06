import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { buildServer } from "../../../server/build-server.js";
import { useRateLimitSafeClock, AUTH, LEGACY_TOKEN } from "@re-cinq/lore-server-core/test-helpers/http-mock.js";

const originalEnv = { ...process.env };
const inject = (url: string, headers: Record<string, string> = AUTH, pool: unknown = null) =>
  buildServer(() => pool as never).inject({ method: "GET", url, headers });

describe("OpenAPI serving routes", () => {
  useRateLimitSafeClock();
  beforeEach(() => {
    process.env.LORE_INGEST_TOKEN = LEGACY_TOKEN;
    delete process.env.LORE_API_URL;
  });
  afterEach(() => {
    process.env = { ...originalEnv };
    vi.clearAllMocks();
  });

  describe("GET /api/openapi.json", () => {
    it("returns the 3.1 document, self-describing its own read scope", async () => {
      const res = await inject("/api/openapi.json");
      expect(res.statusCode).toBe(200);
      const doc = JSON.parse(res.payload);
      expect(doc.openapi).toBe("3.1.0");
      expect(Object.keys(doc.paths).length).toBeGreaterThan(0);
      expect(doc.paths["/api/openapi.json"].get["x-required-scope"]).toBe("read");
    });

    it("returns 401 without a bearer token", async () => {
      const res = await inject("/api/openapi.json", {});
      expect(res.statusCode).toBe(401);
      expect(JSON.parse(res.payload)).toEqual({ error: "unauthorized" });
    });

    it("returns 403 for a token lacking read scope, before the handler runs", async () => {
      const pool = { query: vi.fn().mockResolvedValue({ rows: [{ scopes: ["write"] }] }) };
      const res = await inject("/api/openapi.json", { authorization: "Bearer scoped" }, pool);
      expect(res.statusCode).toBe(403);
    });
  });

  describe("GET /api/docs", () => {
    it("returns an HTML Redoc page with the document inlined", async () => {
      const res = await inject("/api/docs");
      expect(res.statusCode).toBe(200);
      expect(res.headers["content-type"]).toMatch(/text\/html/);
      expect(res.payload).toContain("redoc.standalone.js");
      expect(res.payload).toContain("Redoc.init(");
      expect(res.payload).toContain('"openapi":"3.1.0"');
      expect(res.payload).not.toContain("</script></script>");
    });
  });
});
