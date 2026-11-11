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

    const call = pool.query.mock.calls.find(([querySql]) =>
      String(querySql).includes("INSERT INTO lore.inbox_item_state"),
    );

    expect(call).toMatchObject([
      expect.stringContaining("ON CONFLICT"),
      ["octocat", "plan:123", expect.any(Date), null, true, false],
    ]);
  });

  it("preserves handled_at when only snoozed_until is updated", async () => {
    const pool = makePool();

    pool.query.mockResolvedValue({ rowCount: 1 });

    const res = await putState(
      "plan:123",
      { snoozed_until: "2026-11-12T09:00:00Z", person: "octocat" },
      pool,
    );

    expect(res.statusCode).toBe(200);

    const call = pool.query.mock.calls.find(([querySql]) =>
      String(querySql).includes("INSERT INTO lore.inbox_item_state"),
    );

    expect(call).toMatchObject([
      expect.stringContaining("CASE WHEN $5"),
      ["octocat", "plan:123", null, "2026-11-12T09:00:00Z", false, true],
    ]);
  });

  it("rejects an empty person or a non-ISO snoozed_until with 400", async () => {
    const emptyPerson = await putState("plan:123", {
      handled: true,
      person: "",
    });
    const badSnooze = await putState("plan:123", {
      snoozed_until: "not-a-date",
      person: "octocat",
    });

    expect(emptyPerson.statusCode).toBe(400);
    expect(badSnooze.statusCode).toBe(400);
  });
});
