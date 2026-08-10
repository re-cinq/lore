import { describe, it, expect, afterEach, vi } from "vitest";
import {
  aggregateMonthToDate,
  fetchLiveCost,
  monthStart,
  type LiveCostRow,
} from "./anthropic-cost-live";

function row(over: Partial<LiveCostRow> = {}): LiveCostRow {
  return {
    date: "2026-08-10",
    model: "claude-opus-5",
    costUsd: 10,
    inputTokens: 1000,
    outputTokens: 100,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    ...over,
  };
}

const FETCHED_AT = "2026-08-10T13:00:00.000Z";

describe("monthStart", () => {
  it("returns 2026-08-01 for a mid-August date", () => {
    expect(monthStart(new Date("2026-08-10T13:00:00.000Z"))).toBe("2026-08-01");
  });

  it("zero-pads single-digit months", () => {
    expect(monthStart(new Date("2026-03-31T23:59:59.000Z"))).toBe("2026-03-01");
  });

  it("uses the UTC month for a timestamp that is a different month locally", () => {
    expect(monthStart(new Date("2026-09-01T00:30:00.000Z"))).toBe("2026-09-01");
  });
});

describe("aggregateMonthToDate", () => {
  it("sums cost and tokens across every row in the month", () => {
    const result = aggregateMonthToDate(
      [row({ costUsd: 10 }), row({ costUsd: 2.5, model: "claude-haiku-4-5" })],
      FETCHED_AT,
      "2026-08-01",
    );

    expect(result.orgMtd).toEqual({
      billed_usd: 12.5,
      input_tokens: 2000,
      output_tokens: 200,
      as_of: FETCHED_AT,
    });
  });

  it("excludes rows dated before the month start", () => {
    const result = aggregateMonthToDate(
      [row({ date: "2026-07-31", costUsd: 999 }), row({ costUsd: 10 })],
      FETCHED_AT,
      "2026-08-01",
    );

    expect(result.orgMtd.billed_usd).toBe(10);
    expect(result.orgDaily).toEqual([
      { bucket_date: "2026-08-10", cost_usd: 10 },
    ]);
  });

  it("returns a null as_of when the month has no rows", () => {
    const result = aggregateMonthToDate(
      [row({ date: "2026-07-15" })],
      FETCHED_AT,
      "2026-08-01",
    );

    expect(result.orgMtd).toEqual({
      billed_usd: 0,
      input_tokens: 0,
      output_tokens: 0,
      as_of: null,
    });
  });

  it("groups by model and orders by cost descending", () => {
    const result = aggregateMonthToDate(
      [
        row({ model: "claude-haiku-4-5", costUsd: 1 }),
        row({ model: "claude-opus-5", costUsd: 30, date: "2026-08-09" }),
        row({ model: "claude-opus-5", costUsd: 5 }),
      ],
      FETCHED_AT,
      "2026-08-01",
    );

    expect(result.orgByModel).toEqual([
      {
        model: "claude-opus-5",
        cost_usd: 35,
        input_tokens: 2000,
        output_tokens: 200,
      },
      {
        model: "claude-haiku-4-5",
        cost_usd: 1,
        input_tokens: 1000,
        output_tokens: 100,
      },
    ]);
  });

  it("groups by day across models and orders by date descending", () => {
    const result = aggregateMonthToDate(
      [
        row({ date: "2026-08-09", costUsd: 3 }),
        row({ date: "2026-08-10", costUsd: 4, model: "claude-haiku-4-5" }),
        row({ date: "2026-08-10", costUsd: 6 }),
      ],
      FETCHED_AT,
      "2026-08-01",
    );

    expect(result.orgDaily).toEqual([
      { bucket_date: "2026-08-10", cost_usd: 10 },
      { bucket_date: "2026-08-09", cost_usd: 3 },
    ]);
  });

  it("includes a row dated exactly on the month start", () => {
    const result = aggregateMonthToDate(
      [row({ date: "2026-08-01", costUsd: 7 })],
      FETCHED_AT,
      "2026-08-01",
    );

    expect(result.orgMtd.billed_usd).toBe(7);
    expect(result.orgDaily).toEqual([
      { bucket_date: "2026-08-01", cost_usd: 7 },
    ]);
  });

  it("returns empty rollups for no rows at all", () => {
    const result = aggregateMonthToDate([], FETCHED_AT, "2026-08-01");

    expect(result).toEqual({
      orgMtd: {
        billed_usd: 0,
        input_tokens: 0,
        output_tokens: 0,
        as_of: null,
      },
      orgByModel: [],
      orgDaily: [],
    });
  });
});

describe("fetchLiveCost", () => {
  const env = process.env;
  const ORIG_URL = env.LORE_FLOOR_URL;
  const ORIG_TOKEN = env.LORE_INGEST_TOKEN;

  function set(name: string, value: string | undefined): void {
    if (value === undefined) {
      delete env[name];
    } else {
      env[name] = value;
    }
  }

  function configure(): void {
    set("LORE_FLOOR_URL", "http://floor.test:8080");
    set("LORE_INGEST_TOKEN", "ingest-secret");
  }

  function respond(body: unknown, ok = true, status = 200) {
    return vi.fn().mockResolvedValue({
      ok,
      status,
      json: () => Promise.resolve(body),
    });
  }

  const PAYLOAD = {
    rows: [row({ costUsd: 1 })],
    fetchedAt: FETCHED_AT,
  };

  afterEach(() => {
    set("LORE_FLOOR_URL", ORIG_URL);
    set("LORE_INGEST_TOKEN", ORIG_TOKEN);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("returns null without calling the Floor when the Floor URL is unset", async () => {
    configure();
    set("LORE_FLOOR_URL", undefined);
    const fetchMock = respond(PAYLOAD);

    vi.stubGlobal("fetch", fetchMock);

    expect(await fetchLiveCost()).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns null without calling the Floor when the ingest token is unset", async () => {
    configure();
    set("LORE_INGEST_TOKEN", undefined);
    const fetchMock = respond(PAYLOAD);

    vi.stubGlobal("fetch", fetchMock);

    expect(await fetchLiveCost()).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns the payload and sends the bearer token on a 200", async () => {
    configure();
    const fetchMock = respond(PAYLOAD);

    vi.stubGlobal("fetch", fetchMock);

    expect(await fetchLiveCost()).toEqual(PAYLOAD);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://floor.test:8080/api/anthropic-cost/live",
      expect.objectContaining({
        headers: { authorization: "Bearer ingest-secret" },
        cache: "no-store",
      }),
    );
  });

  it("bounds the request with an abort signal so a hung Floor cannot stall the render", async () => {
    configure();
    const fetchMock = respond(PAYLOAD);

    vi.stubGlobal("fetch", fetchMock);

    await fetchLiveCost();

    const init = fetchMock.mock.calls[0][1] as RequestInit;

    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("returns null on a 503 from the Floor", async () => {
    configure();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.stubGlobal("fetch", respond(null, false, 503));

    expect(await fetchLiveCost()).toBeNull();
  });

  it("returns null when the payload is missing rows or fetchedAt", async () => {
    configure();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.stubGlobal("fetch", respond({ rows: "not-an-array" }));

    expect(await fetchLiveCost()).toBeNull();
  });

  it("returns null when the request rejects", async () => {
    configure();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("connect ECONNREFUSED")),
    );

    expect(await fetchLiveCost()).toBeNull();
  });
});
