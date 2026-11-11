import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { buildServer } from "../../../app/build-server.js";
import {
  makePool,
  useRateLimitSafeClock,
  AUTH,
  LEGACY_TOKEN,
} from "@re-cinq/lore-server-core/test-helpers/http-mock.js";

const originalEnv = { ...process.env };

describe("PUT /api/inbox/items/{item_id}/state", () => {
  useRateLimitSafeClock();

  beforeEach(() => {
    process.env.LORE_INGEST_TOKEN = LEGACY_TOKEN;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.clearAllMocks();
  });

  function putState(itemId: string, body: unknown, pool: unknown = makePool()) {
    const payload = typeof body === "string" ? body : JSON.stringify(body);

    return buildServer(() => pool as any).inject({
      method: "PUT",
      url: `/api/inbox/items/${encodeURIComponent(itemId)}/state`,
      headers: AUTH,
      payload,
    });
  }

  it("updates the DB for the calling user when marked handled", async () => {
    const pool = makePool();

    pool.query.mockResolvedValue({ rowCount: 1 });

    const res = await putState(
      "plan:123",
      { handled: true, person: "octocat" },
      pool,
    );

    expect(res.statusCode).toBe(200);

    const call = pool.query.mock.calls.find(([querySql]: [string]) =>
      String(querySql).includes("INSERT INTO lore.inbox_item_state"),
    );

    expect(call).toMatchObject([
      expect.stringContaining("ON CONFLICT"),
      expect.arrayContaining(["octocat", "plan:123"])
    ]);
  });
});
