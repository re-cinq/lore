import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { buildServer } from "../../../app/build-server.js";
import {
  makePool,
  useRateLimitSafeClock,
  AUTH,
  LEGACY_TOKEN,
} from "@re-cinq/lore-server-core/test-helpers/http-mock.js";

const originalEnv = { ...process.env };

const get = (url: string, pool: unknown) =>
  buildServer(() => pool as never).inject({
    method: "GET",
    url,
    headers: AUTH,
  });

function poolHolding(chunkRows: unknown[]) {
  const pool = makePool();

  pool.query.mockImplementation(async (sql: string) => ({
    rows: /\.chunks/.test(sql) ? chunkRows : [],
  }));

  return pool;
}

describe("GET /api/context-evals/documents", () => {
  useRateLimitSafeClock();
  beforeEach(() => {
    process.env.LORE_INGEST_TOKEN = LEGACY_TOKEN;
  });
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("lists the accepted ADR and leaves the Retired spec out", async () => {
    const pool = poolHolding([
      { file_path: "adrs/ADR-007.md", head: "---\nstatus: accepted\n---" },
      { file_path: "specs/a/spec.md", head: "| Status | Retired |" },
    ]);
    const res = await get(
      "/api/context-evals/documents?repo=re-cinq/lore",
      pool,
    );

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload)).toEqual({
      documents: ["adrs/ADR-007.md"],
    });
  });

  it("answers 400 without a repo", async () => {
    expect(
      (await get("/api/context-evals/documents", poolHolding([]))).statusCode,
    ).toBe(400);
  });

  it("answers 503 when there is no database", async () => {
    expect(
      (await get("/api/context-evals/documents?repo=re-cinq/lore", null))
        .statusCode,
    ).toBe(503);
  });
});
