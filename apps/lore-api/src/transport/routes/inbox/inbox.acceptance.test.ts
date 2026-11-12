import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { buildServer } from "../../../app/build-server.js";
import {
  makePool,
  useRateLimitSafeClock,
  AUTH,
  LEGACY_TOKEN,
} from "@re-cinq/lore-server-core/test-helpers/http-mock.js";

const originalEnv = { ...process.env };
const get = (pool: unknown, url: string) =>
  buildServer(() => pool as any).inject({ method: "GET", url, headers: AUTH });

describe("Inbox GET route (Acceptance)", () => {
  useRateLimitSafeClock();
  beforeEach(() => {
    process.env.LORE_INGEST_TOKEN = LEGACY_TOKEN;
  });
  afterEach(() => {
    process.env = { ...originalEnv };
    vi.clearAllMocks();
  });

  it("successfully returns 200 and mapped Plan and Onboarding PR items", async () => {
    const pool = poolWithOnePlanAndOneOnboarding();

    const res = await get(pool, "/api/inbox");

    expect(res.statusCode).toBe(200);

    const payload = res.result as Record<string, unknown>;

    expect(payload.items).toBeDefined();
    expect(payload.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "plan_review",
          id: "plan:b45a2789-982c-473d-8ab1-2b6fb0a5b28d",
          title: "Mock Plan",
          repo: "re-cinq/lore",
          open_url:
            "/repos/re-cinq/lore/plans/b45a2789-982c-473d-8ab1-2b6fb0a5b28d",
        }),
        expect.objectContaining({
          kind: "onboarding_pr",
          id: "onboarding:re-cinq/mock-repo",
          repo: "re-cinq/mock-repo",
        }),
      ]),
    );
  });

  it("counts plan_review 1 and onboarding_pr 1 for one in-review plan and one open onboarding PR", async () => {
    const res = await get(poolWithOnePlanAndOneOnboarding(), "/api/inbox");

    expect((res.result as Record<string, unknown>).counts).toEqual({
      plan_review: 1,
      onboarding_pr: 1,
    });
  });
});

function poolWithOnePlanAndOneOnboarding() {
  const pool = makePool();

  pool.query.mockImplementation(async (sql: string) => {
    const query = sql.toLowerCase();

    if (query.includes("lore.plans")) {
      return {
        rows: [
          {
            id: "b45a2789-982c-473d-8ab1-2b6fb0a5b28d",
            repo: "re-cinq/lore",
            title: "Mock Plan",
            status: "in-review",
            type: "feature",
            created_by: "alice",
            created_at: new Date("2026-10-13T00:00:00.000Z"),
            updated_at: new Date("2026-10-13T00:00:00.000Z"),
          },
        ],
      };
    }

    if (
      query.includes("lore.repos") &&
      query.includes("onboarding_pr_merged = false")
    ) {
      return {
        rows: [
          {
            id: "repo-uuid",
            full_name: "re-cinq/mock-repo",
            onboarding_pr_url: "https://github.com/re-cinq/mock-repo/pull/1",
            onboarded_at: new Date("2026-10-13T00:00:00.000Z"),
          },
        ],
      };
    }

    return { rows: [] };
  });

  return pool;
}
