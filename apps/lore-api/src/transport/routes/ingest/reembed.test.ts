import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { buildServer } from "../../../app/build-server.js";
import {
  makePool,
  useRateLimitSafeClock,
  AUTH,
  LEGACY_TOKEN,
} from "@re-cinq/lore-server-core/test-helpers/http-mock.js";

vi.mock("../../../work/embeddings/backfill.js", () => ({
  backfillEmbeddings: vi.fn(),
}));

import { backfillEmbeddings } from "../../../work/embeddings/backfill.js";

const originalEnv = { ...process.env };

const post = (body: unknown) =>
  buildServer(() => makePool() as any).inject({
    method: "POST",
    url: "/api/ingest/reembed",
    headers: AUTH,
    payload: JSON.stringify(body),
  });

describe("POST /api/ingest/reembed", () => {
  useRateLimitSafeClock();
  beforeEach(() => {
    process.env.LORE_INGEST_TOKEN = LEGACY_TOKEN;
    vi.mocked(backfillEmbeddings).mockResolvedValue({
      embedded: 100,
      failed: 0,
      remaining: 340,
      stopped: false,
    });
  });
  afterEach(() => {
    process.env = { ...originalEnv };
    vi.clearAllMocks();
  });

  it("runs one batch of 100 missing embeddings by default and returns the counts", async () => {
    const res = await post({});

    expect({
      status: res.statusCode,
      body: res.result,
      options: vi.mocked(backfillEmbeddings).mock.calls[0][2],
    }).toEqual({
      status: 200,
      body: { embedded: 100, failed: 0, remaining: 340, stopped: false },
      options: { schema: undefined, limit: 100, where: "missing" },
    });
  });

  it("passes schema platform, limit 500 and where stale_links through", async () => {
    await post({ schema: "platform", limit: 500, where: "stale_links" });

    expect(vi.mocked(backfillEmbeddings).mock.calls[0][2]).toEqual({
      schema: "platform",
      limit: 500,
      where: "stale_links",
    });
  });

  it("rejects a limit of 501 with 400 before touching the store", async () => {
    const res = await post({ limit: 501 });

    expect({
      status: res.statusCode,
      calls: vi.mocked(backfillEmbeddings).mock.calls.length,
    }).toEqual({
      status: 400,
      calls: 0,
    });
  });
});
