import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { buildServer } from "../../../app/build-server.js";
import {
  makePool,
  useRateLimitSafeClock,
  AUTH,
  LEGACY_TOKEN,
} from "@re-cinq/lore-server-core/test-helpers/http-mock.js";

vi.mock("../../../outbound/project-boot.js", () => ({
  projectFor: vi.fn(async () => ({
    repo: { defaultBranch: async () => "main" },
    pulls: {
      getBranchRule: async () => ({
        requiredApprovals: 1,
        codeOwnersReview: true,
        requiredChecks: ["build"],
      }),
    },
  })),
}));

vi.mock("../../../outbound/github-client.js", () => ({
  getOctokit: vi.fn(),
  isAppConfigured: vi.fn().mockReturnValue(true),
}));

const originalEnv = { ...process.env };

describe("PUT /api/repos/{owner}/{repo}/settings", () => {
  useRateLimitSafeClock();
  beforeEach(() => {
    process.env.LORE_INGEST_TOKEN = LEGACY_TOKEN;
  });
  afterEach(() => {
    process.env = { ...originalEnv };
    vi.clearAllMocks();
  });

  function put(payload: unknown, pool: unknown = makePool()) {
    return buildServer(() => pool as never).inject({
      method: "PUT",
      url: "/api/repos/re-cinq/lore/settings",
      headers: AUTH,
      payload: JSON.stringify(payload),
    });
  }

  it("returns 503 when pool is null", async () => {
    expect((await put({ team: "platform" }, null)).statusCode).toBe(503);
  });

  it("returns 404 for a repo with no row", async () => {
    const pool = makePool();

    pool.query.mockResolvedValue({ rows: [] });

    expect((await put({ team: "platform" }, pool)).statusCode).toBe(404);
  });

  it("updates the team and merges the settings patch", async () => {
    const pool = makePool();

    pool.query
      .mockResolvedValueOnce({
        rows: [{ full_name: "re-cinq/lore", team: null }],
      })
      .mockResolvedValue({ rows: [] });

    const res = await put(
      { team: "platform", settings: { auto_review: true } },
      pool,
    );

    expect(res.statusCode).toBe(200);
    const update = pool.query.mock.calls.find(([sql]) =>
      String(sql).includes("UPDATE lore.repos"),
    );

    expect(update?.[0]).toContain("team = $1");
    expect(update?.[0]).toContain("COALESCE(settings, '{}') || $2::jsonb");
  });

  it("returns 400 for a patch that carries a dark_factory block", async () => {
    const pool = makePool();

    pool.query.mockResolvedValue({
      rows: [{ full_name: "re-cinq/lore", team: null }],
    });
    const res = await put(
      { settings: { dark_factory: { review: "never" } } },
      pool,
    );

    expect(res.statusCode).toBe(400);
    expect(res.result).toMatchObject({
      error: "dark_factory settings were removed on 2026-10-02",
    });
    expect(
      pool.query.mock.calls.some(([sql]) =>
        String(sql).includes("UPDATE lore.repos"),
      ),
    ).toBe(false);
  });

  it("emits internal.repo.team_changed when the team value changes", async () => {
    const pool = makePool();

    pool.query
      .mockResolvedValueOnce({
        rows: [{ full_name: "re-cinq/lore", team: null }],
      })
      .mockResolvedValue({ rows: [] });
    await put({ team: "platform" }, pool);

    const event = pool.query.mock.calls.find(([sql]) =>
      String(sql).includes("INSERT INTO pipeline.events"),
    );

    expect(event?.[1]).toEqual([
      "internal.repo.team_changed",
      "internal",
      JSON.stringify({ repo: "re-cinq/lore" }),
      "re-cinq/lore",
      null,
    ]);
  });

  it("emits no event when the posted team equals the stored one", async () => {
    const pool = makePool();

    pool.query
      .mockResolvedValueOnce({
        rows: [{ full_name: "re-cinq/lore", team: "platform" }],
      })
      .mockResolvedValue({ rows: [] });
    await put({ team: "platform" }, pool);

    expect(
      pool.query.mock.calls.some(([sql]) =>
        String(sql).includes("INSERT INTO pipeline.events"),
      ),
    ).toBe(false);
  });

  it("still saves when the team_changed event insert fails", async () => {
    const pool = makePool();

    pool.query
      .mockResolvedValueOnce({
        rows: [{ full_name: "re-cinq/lore", team: null }],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockRejectedValueOnce(new Error("events table down"));

    const res = await put({ team: "platform" }, pool);

    expect(res.statusCode).toBe(200);
    expect(res.result).toEqual({ ok: true });
  });

  it("returns 400 for a digest block with a weekday of 9", async () => {
    const pool = makePool();

    pool.query.mockResolvedValue({
      rows: [{ full_name: "re-cinq/lore", team: null }],
    });
    const res = await put(
      { settings: { digest: { enabled: true, days: [1, 9] } } },
      pool,
    );

    expect(res.statusCode).toBe(400);
    expect(pool.query.mock.calls.length).toBe(1);
  });

  it("returns 400 for a digest block whose timezone is not an IANA zone", async () => {
    const pool = makePool();

    pool.query.mockResolvedValue({
      rows: [{ full_name: "re-cinq/lore", team: null }],
    });
    const res = await put(
      {
        settings: { digest: { enabled: true, timezone: "Mars/Olympus_Mons" } },
      },
      pool,
    );

    expect({
      status: res.statusCode,
      queries: pool.query.mock.calls.length,
    }).toEqual({
      status: 400,
      queries: 1,
    });
  });

  it("merges digest: null so a repo can clear its digest block", async () => {
    const pool = makePool();

    pool.query
      .mockResolvedValueOnce({
        rows: [{ full_name: "re-cinq/lore", team: null }],
      })
      .mockResolvedValue({ rows: [] });
    const res = await put({ settings: { digest: null } }, pool);

    expect(res.statusCode).toBe(200);
  });

  it("merges a well-formed digest block", async () => {
    const pool = makePool();

    pool.query
      .mockResolvedValueOnce({
        rows: [{ full_name: "re-cinq/lore", team: null }],
      })
      .mockResolvedValue({ rows: [] });
    const res = await put(
      {
        settings: {
          digest: { enabled: true, time: "08:30", days: [1, 2, 3, 4, 5] },
        },
      },
      pool,
    );

    expect(res.statusCode).toBe(200);
  });

  it("returns 400 when the patch names no field to update", async () => {
    const pool = makePool();

    pool.query.mockResolvedValue({
      rows: [{ full_name: "re-cinq/lore", team: null }],
    });

    expect((await put({}, pool)).statusCode).toBe(400);
  });

  it("returns 403 two_key_required for an auto_merge.approver change to lore-reviewer without the approval header", async () => {
    const pool = makePool();

    pool.query.mockResolvedValue({
      rows: [{ full_name: "re-cinq/lore", team: null }],
    });

    const res = await put(
      { settings: { auto_merge: { approver: "lore-reviewer" } } },
      pool,
    );

    expect(res.statusCode).toBe(403);
    expect(res.result).toEqual({
      error: "two_key_required",
      field_paths: ["auto_merge.approver"],
      detail: "Turning auto_merge.approver on is two-key",
    });
  });

  it("returns 400 for an auto_merge.approver of admin", async () => {
    const pool = makePool();

    pool.query.mockResolvedValue({
      rows: [{ full_name: "re-cinq/lore", team: null }],
    });

    const res = await put(
      { settings: { auto_merge: { approver: "admin" } } },
      pool,
    );

    expect(res.statusCode).toBe(400);
  });

  it("returns 400 for a context_backend of dgraph", async () => {
    const pool = makePool();

    pool.query.mockResolvedValue({
      rows: [{ full_name: "re-cinq/lore", team: null }],
    });
    const res = await put({ settings: { context_backend: "dgraph" } }, pool);

    expect({ status: res.statusCode, result: res.result }).toMatchObject({
      status: 400,
      result: { error: "context_backend must be lore, utopia or both" },
    });
  });
});
