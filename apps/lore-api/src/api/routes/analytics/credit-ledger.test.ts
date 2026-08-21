import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { buildServer } from "../../../server/build-server.js";
import {
  makePool,
  useRateLimitSafeClock,
  AUTH,
  LEGACY_TOKEN,
} from "@re-cinq/lore-server-core/test-helpers/http-mock.js";

const originalEnv = { ...process.env };

const undefinedTable = () =>
  Object.assign(new Error("no such table"), { code: "42P01" });

const RECORDED = {
  id: 1,
  effective_date: "2026-08-21",
  amount_usd: 100,
  kind: "topup",
  note: "",
  actor: "",
};

describe("POST /api/spend/credits", () => {
  useRateLimitSafeClock();
  beforeEach(() => {
    process.env.LORE_INGEST_TOKEN = LEGACY_TOKEN;
  });
  afterEach(() => {
    process.env = { ...originalEnv };
    vi.clearAllMocks();
  });

  function post(payload: unknown, pool: unknown = makePool()) {
    return buildServer(() => pool as never).inject({
      method: "POST",
      url: "/api/spend/credits",
      headers: AUTH,
      payload: payload as Record<string, unknown>,
    });
  }

  function poolRecording() {
    const pool = makePool();

    pool.query.mockResolvedValue({ rows: [RECORDED] });

    return pool;
  }

  it("returns 401 without a bearer token", async () => {
    // A write endpoint that moves the number everyone reads off the dashboard
    // gets its scope pinned here, not assumed from the registration list.
    const res = await buildServer(() => makePool() as never).inject({
      method: "POST",
      url: "/api/spend/credits",
      payload: { amount_usd: 100 },
    });

    expect(res.statusCode).toBe(401);
  });

  it("returns 503 when pool is null", async () => {
    expect((await post({ amount_usd: 100 }, null)).statusCode).toBe(503);
  });

  it("returns 201 with the recorded entry", async () => {
    const res = await post({ amount_usd: 100 }, poolRecording());

    expect(res.statusCode).toBe(201);
    expect(res.result).toMatchObject({ amount_usd: 100, kind: "topup" });
  });

  it("defaults a missing effective_date to today and the kind to topup", async () => {
    // The common case is recording a top-up the day it happens, so the form
    // asks for an amount and nothing else. `current_date` is resolved by
    // Postgres via COALESCE rather than by this process, which has no business
    // deciding what day it is for the database.
    const pool = poolRecording();

    await post({ amount_usd: 100 }, pool);

    const [sql, params] = pool.query.mock.calls[0];

    expect(String(sql)).toContain("COALESCE($1::date, current_date)");
    expect(params).toEqual([null, 100, "topup", "", ""]);
  });

  it("passes an explicit effective_date through for a late-recorded top-up", async () => {
    // Money that landed on the 14th and was recorded on the 21st anchors the
    // spend window to the 14th — otherwise a week of spend goes uncounted.
    const pool = poolRecording();

    await post({ amount_usd: 250, effective_date: "2026-08-14" }, pool);

    expect(pool.query.mock.calls[0][1]).toEqual([
      "2026-08-14",
      250,
      "topup",
      "",
      "",
    ]);
  });

  it("records a negative amount as a correction", async () => {
    // The append-only escape hatch: a mistyped entry is compensated, never
    // updated, so the ledger keeps both the error and its correction.
    const pool = poolRecording();

    await post({ amount_usd: -20, kind: "correction", note: "typo" }, pool);

    expect(pool.query.mock.calls[0][1]).toEqual([
      null,
      -20,
      "correction",
      "typo",
      "",
    ]);
  });

  it("returns 400 for an amount of zero", async () => {
    const res = await post({ amount_usd: 0 });

    expect(res.statusCode).toBe(400);
  });

  it("returns 400 for a date that is not YYYY-MM-DD", async () => {
    const res = await post({ amount_usd: 100, effective_date: "21/08/2026" });

    expect(res.statusCode).toBe(400);
  });

  it("returns 400 for a kind outside opening, topup and correction", async () => {
    const res = await post({ amount_usd: 100, kind: "refund" });

    expect(res.statusCode).toBe(400);
  });

  it("returns 503 when the credit-ledger table has not been migrated yet", async () => {
    // Unrecordable, not malformed — a 400 here would send the operator hunting
    // through their own payload for a fault that lives in the deploy.
    const pool = makePool();

    pool.query.mockRejectedValue(undefinedTable());

    expect((await post({ amount_usd: 100 }, pool)).statusCode).toBe(503);
  });
});
