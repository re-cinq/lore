import { describe, it, expect, afterEach, vi } from "vitest";
import Hapi from "@hapi/hapi";
import { registerBearerAuth } from "../auth.js";
import { anthropicCostLiveRoute } from "./anthropic-cost-live.js";
import type { AnthropicCostDailyRow } from "../../../jobs/cost/anthropic-cost.js";

const ORIG_TOKEN = process.env.LORE_INGEST_TOKEN;
const ORIG_ADMIN_KEY = process.env.ANTHROPIC_ADMIN_KEY;

function restore(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

afterEach(() => {
  restore("LORE_INGEST_TOKEN", ORIG_TOKEN);
  restore("ANTHROPIC_ADMIN_KEY", ORIG_ADMIN_KEY);
});

const ROW: AnthropicCostDailyRow = {
  date: "2026-08-10",
  model: "claude-opus-5",
  costUsd: 12.5,
  inputTokens: 1000,
  outputTokens: 200,
  cacheCreationTokens: 0,
  cacheReadTokens: 500,
};

function liveServer(
  fetchRows: (adminKey: string) => Promise<AnthropicCostDailyRow[]>,
  ttlMs = 60_000,
) {
  const server = Hapi.server({ port: 0 });

  registerBearerAuth(server);
  server.route(anthropicCostLiveRoute(fetchRows, ttlMs));

  return server;
}

function get(server: Hapi.Server, token = "ingest-secret") {
  return server.inject({
    method: "GET",
    url: "/api/anthropic-cost/live",
    headers: { authorization: `Bearer ${token}` },
  });
}

describe("GET /api/anthropic-cost/live", () => {
  it("returns 401 when the bearer token does not match", async () => {
    process.env.LORE_INGEST_TOKEN = "ingest-secret";
    process.env.ANTHROPIC_ADMIN_KEY = "sk-ant-admin-test";

    expect(
      (
        await get(
          liveServer(() => Promise.resolve([ROW])),
          "wrong",
        )
      ).statusCode,
    ).toBe(401);
  });

  it("returns 503 when ANTHROPIC_ADMIN_KEY is unset", async () => {
    process.env.LORE_INGEST_TOKEN = "ingest-secret";
    delete process.env.ANTHROPIC_ADMIN_KEY;
    const fetchRows = vi.fn(() => Promise.resolve([ROW]));

    expect((await get(liveServer(fetchRows))).statusCode).toBe(503);
    expect(fetchRows).not.toHaveBeenCalled();
  });

  it("returns the fetched rows alongside a fetchedAt timestamp", async () => {
    process.env.LORE_INGEST_TOKEN = "ingest-secret";
    process.env.ANTHROPIC_ADMIN_KEY = "sk-ant-admin-test";

    const res = await get(liveServer(() => Promise.resolve([ROW])));

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload)).toMatchObject({
      rows: [ROW],
      fetchedAt: expect.stringMatching(
        /^\d{4}-\d{2}-\d{2}T/,
      ) as unknown as string,
    });
  });

  it("passes the admin key from the environment to the fetcher", async () => {
    process.env.LORE_INGEST_TOKEN = "ingest-secret";
    process.env.ANTHROPIC_ADMIN_KEY = "sk-ant-admin-test";
    const fetchRows = vi.fn(() => Promise.resolve([ROW]));

    await get(liveServer(fetchRows));

    expect(fetchRows).toHaveBeenCalledWith("sk-ant-admin-test");
  });

  it("serves concurrent and repeat requests inside the TTL from one upstream call", async () => {
    process.env.LORE_INGEST_TOKEN = "ingest-secret";
    process.env.ANTHROPIC_ADMIN_KEY = "sk-ant-admin-test";
    const fetchRows = vi.fn(() => Promise.resolve([ROW]));
    const server = liveServer(fetchRows);

    await Promise.all([get(server), get(server)]);
    await get(server);

    expect(fetchRows).toHaveBeenCalledTimes(1);
  });

  it("calls upstream again once the TTL has elapsed", async () => {
    process.env.LORE_INGEST_TOKEN = "ingest-secret";
    process.env.ANTHROPIC_ADMIN_KEY = "sk-ant-admin-test";
    const fetchRows = vi.fn(() => Promise.resolve([ROW]));
    const server = liveServer(fetchRows, 0);

    await get(server);
    await get(server);

    expect(fetchRows).toHaveBeenCalledTimes(2);
  });

  it("retries upstream after a rejection instead of caching the failure", async () => {
    process.env.LORE_INGEST_TOKEN = "ingest-secret";
    process.env.ANTHROPIC_ADMIN_KEY = "sk-ant-admin-test";
    const fetchRows = vi
      .fn<(adminKey: string) => Promise<AnthropicCostDailyRow[]>>()
      .mockRejectedValueOnce(new Error("Anthropic usage_report returned 500"))
      .mockResolvedValue([ROW]);
    const server = liveServer(fetchRows);

    expect((await get(server)).statusCode).toBe(500);

    const second = await get(server);

    expect(second.statusCode).toBe(200);
    expect(fetchRows).toHaveBeenCalledTimes(2);
  });
});
