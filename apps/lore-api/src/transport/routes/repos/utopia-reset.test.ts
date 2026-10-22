import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { buildServer } from "../../../app/build-server.js";
import {
  makePool,
  useRateLimitSafeClock,
  AUTH,
  LEGACY_TOKEN,
} from "@re-cinq/lore-server-core/test-helpers/http-mock.js";

const originalEnv = { ...process.env };

const poolHolding = (repos: string[], deletedPointers = 2) => {
  const pool = makePool();

  pool.query.mockImplementation(async (sql: string, params: string[]) => {
    if (/FROM lore\.repos/.test(sql)) {
      return {
        rows: repos.includes(params[0]) ? [{ full_name: params[0] }] : [],
      };
    }

    return {
      rows: [],
      rowCount: /DELETE FROM pipeline\.ingest_state/.test(sql)
        ? deletedPointers
        : 1,
    };
  });

  return pool;
};

const reset = (pool: unknown, repo = "re-cinq/lore") =>
  buildServer(() => pool as never).inject({
    method: "POST",
    url: `/api/repos/${repo}/utopia/reset`,
    headers: AUTH,
  });

const writes = (pool: ReturnType<typeof makePool>, pattern: RegExp) =>
  pool.query.mock.calls
    .filter(([sql]) => pattern.test(sql))
    .map(([, params]) => params);

describe("POST /api/repos/{owner}/{repo}/utopia/reset", () => {
  useRateLimitSafeClock();
  beforeEach(() => {
    process.env.LORE_INGEST_TOKEN = LEGACY_TOKEN;
    process.env.UTOPIA_API_URL = "http://utopia.test";
  });
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("drops re-cinq/lore's commit and tracker cursors and its code and test-report ingest pointers, and answers the 2 pointers it deleted", async () => {
    const pool = poolHolding(["re-cinq/lore"]);
    const res = await reset(pool);

    expect({
      status: res.statusCode,
      body: res.result,
      cursors: writes(pool, /#- '\{utopia,commits_head\}'/),
      pointers: writes(pool, /DELETE FROM pipeline\.ingest_state/),
    }).toEqual({
      status: 200,
      body: { ingest_state_cleared: 2 },
      cursors: [["re-cinq/lore"]],
      pointers: [["re-cinq/lore", ["code", "test-report"]]],
    });
  });

  it("answers 404 for a repo Lore does not hold and changes nothing", async () => {
    const pool = poolHolding(["re-cinq/lore"]);
    const res = await reset(pool, "re-cinq/ghost");

    expect({
      status: res.statusCode,
      cursors: writes(pool, /#- '\{utopia,commits_head\}'/),
    }).toEqual({ status: 404, cursors: [] });
  });

  it("answers 503 when UTOPIA_API_URL is unset", async () => {
    delete process.env.UTOPIA_API_URL;

    expect((await reset(poolHolding(["re-cinq/lore"]))).statusCode).toBe(503);
  });
});
