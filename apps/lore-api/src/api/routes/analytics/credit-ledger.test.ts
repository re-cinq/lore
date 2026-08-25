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

  it("anchors a dateless entry to the START of today, not to now", async () => {
    // The trap this pins: stamping `now()` would exclude everything spent
    // between the money landing and someone typing it in — spend that came
    // straight out of the new balance — and report MORE remaining than there
    // is. Midnight can only ever over-count, which is the safe direction.
    const pool = poolRecording();

    await post({ amount_usd: 100 }, pool);

    const [sql, params] = pool.query.mock.calls[0];

    expect(String(sql)).toContain("COALESCE($1::date, current_date)");
    expect(String(sql)).toContain("COALESCE($2::time, time '00:00')");
    expect(String(sql)).not.toContain("now()");
    expect(params).toEqual([null, null, 100, "topup", "", ""]);
  });

  it("passes an explicit effective_date through for a late-recorded top-up", async () => {
    // Money that landed on the 14th and was recorded on the 21st. For a
    // top-up the date is documentation only — the remaining arithmetic reads
    // the opening entry's moment and nothing else — but it must still be
    // stored as given rather than as the day it was typed in.
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
    // Topped up at 20:00 on the 14th, typed in the next day: the pair is
    // composed in Postgres so the entry lands on the evening it happened.
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

  it("records a negative amount as a correction", async () => {
    // The append-only escape hatch: a mistyped entry is compensated, never
    // updated, so the ledger keeps both the error and its correction.
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

  it("returns 503 when the credit-ledger table has not been migrated yet", async () => {
    // Unrecordable, not malformed — a 400 here would send the operator hunting
    // through their own payload for a fault that lives in the deploy.
    const pool = makePool();

    pool.query.mockRejectedValue(undefinedTable());

    expect((await post({ amount_usd: 100 }, pool)).statusCode).toBe(503);
  });

  it.each(["2026-02-30", "2026-13-01", "2026-04-31", "2025-02-29"])(
    "returns 400 for the impossible date %s",
    async (effectiveDate) => {
      // Shape is not validity: each of these matches the YYYY-MM-DD regex and
      // each makes Postgres raise 22008 (date/time field value out of range).
      // 22008 is not the 42P01 the handler catches, so before this was pinned
      // an impossible date rethrew as a 500 — the caller reported their own
      // typo accurately and was told the server was broken.
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
    // The guard must reject impossible dates without rejecting unusual ones.
    const pool = poolRecording();

    const res = await post(
      { amount_usd: 100, effective_date: "2028-02-29" },
      pool,
    );

    expect(res.statusCode).toBe(201);
    expect(pool.query.mock.calls[0][1]?.[0]).toBe("2028-02-29");
  });
});
