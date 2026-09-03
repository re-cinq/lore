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
  effective_at: "2026-08-21T00:00:00Z",
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

  it("returns 401 without a bearer token — scope pinned here, not inherited from registration", async () => {
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

  it("anchors a dateless entry to the START of today, not to now (over-counts, the safe direction)", async () => {
    const pool = poolRecording();

    await post({ amount_usd: 100 }, pool);

    const [sql, params] = pool.query.mock.calls[0];

    expect(String(sql)).toContain("COALESCE($1::date, current_date)");
    expect(String(sql)).toContain("COALESCE($2::time, time '00:00')");
    expect(String(sql)).not.toContain("now()");
    expect(params).toEqual([null, null, 100, "topup", "", ""]);
  });

  it("passes an explicit effective_date through for a late-recorded top-up", async () => {
    const pool = poolRecording();

    await post({ amount_usd: 250, effective_date: "2026-08-14" }, pool);

    expect(pool.query.mock.calls[0][1]).toEqual([
      "2026-08-14",
      null,
      250,
      "topup",
      "",
      "",
    ]);
  });

  it("composes a date and time into one moment when the time is known", async () => {
    const pool = poolRecording();

    await post(
      {
        amount_usd: 250,
        effective_date: "2026-08-14",
        effective_time: "20:00",
      },
      pool,
    );

    expect(pool.query.mock.calls[0][1]).toEqual([
      "2026-08-14",
      "20:00",
      250,
      "topup",
      "",
      "",
    ]);
  });

  it("returns 400 for a time that is not HH:MM", async () => {
    expect(
      (await post({ amount_usd: 100, effective_time: "8pm" })).statusCode,
    ).toBe(400);
  });

  it("returns 400 for an hour outside the clock", async () => {
    expect(
      (await post({ amount_usd: 100, effective_time: "24:00" })).statusCode,
    ).toBe(400);
  });

  it("records a negative amount as a correction, never an update (append-only)", async () => {
    const pool = poolRecording();

    await post({ amount_usd: -20, kind: "correction", note: "typo" }, pool);

    expect(pool.query.mock.calls[0][1]).toEqual([
      null,
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

  it("returns 503 (unrecordable), not 400, when the credit-ledger table has not been migrated yet", async () => {
    const pool = makePool();

    pool.query.mockRejectedValue(undefinedTable());

    expect((await post({ amount_usd: 100 }, pool)).statusCode).toBe(503);
  });

  it.each(["2026-02-30", "2026-13-01", "2026-04-31", "2025-02-29"])(
    "returns 400, not a Postgres-22008-rethrown 500, for the impossible date %s",
    async (effectiveDate) => {
      const pool = makePool();

      const res = await post(
        { amount_usd: 100, effective_date: effectiveDate },
        pool,
      );

      expect(res.statusCode).toBe(400);
      expect(pool.query).not.toHaveBeenCalled();
    },
  );

  it("still accepts a real leap day", async () => {
    const pool = poolRecording();

    const res = await post(
      { amount_usd: 100, effective_date: "2028-02-29" },
      pool,
    );

    expect(res.statusCode).toBe(201);
    expect(pool.query.mock.calls[0][1]?.[0]).toBe("2028-02-29");
  });
});
