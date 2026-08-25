import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { buildServer } from "../../../server/build-server.js";
import {
  makePool,
  useRateLimitSafeClock,
  AUTH,
  LEGACY_TOKEN,
} from "@re-cinq/lore-server-core/test-helpers/http-mock.js";

const originalEnv = { ...process.env };

/**
 * The privileged-field refusal is the point of these cases. `lore.settings`-style
 * blanket merging into `lore.repos.settings` would let a caller flip
 * `dark_factory.enabled` — or widen `auto_merge.paths`, or turn a `require_*`
 * gate off — and skip the CODEOWNER-approval ceremony that
 * `PUT /settings/dark-factory` enforces. This route refuses those fields and
 * names the endpoint that owns them.
 */
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

  it("refuses a patch that touches dark_factory.enabled", async () => {
    const pool = makePool();

    pool.query.mockResolvedValue({
      rows: [{ full_name: "re-cinq/lore", team: null }],
    });
    const res = await put(
      { settings: { dark_factory: { enabled: true } } },
      pool,
    );

    expect(res.statusCode).toBe(403);
    expect(res.result).toMatchObject({
      error: expect.stringContaining("dark-factory"),
    });
  });

  it("refuses a patch that widens auto_merge.paths", async () => {
    const pool = makePool();

    pool.query.mockResolvedValue({
      rows: [{ full_name: "re-cinq/lore", team: null }],
    });
    const res = await put(
      { settings: { dark_factory: { auto_merge: { paths: ["**"] } } } },
      pool,
    );

    expect(res.statusCode).toBe(403);
  });

  it("refuses a patch that turns a require_ gate off", async () => {
    const pool = makePool();

    pool.query.mockResolvedValue({
      rows: [{ full_name: "re-cinq/lore", team: null }],
    });
    const res = await put(
      {
        settings: {
          dark_factory: { auto_merge: { require_green_ci: false } },
        },
      },
      pool,
    );

    expect(res.statusCode).toBe(403);
  });

  it("writes nothing at all when it refuses", async () => {
    const pool = makePool();

    pool.query.mockResolvedValue({
      rows: [{ full_name: "re-cinq/lore", team: null }],
    });
    await put({ settings: { dark_factory: { enabled: true } } }, pool);

    expect(
      pool.query.mock.calls.some(([sql]) =>
        String(sql).includes("UPDATE lore.repos"),
      ),
    ).toBe(false);
  });

  it("allows a non-privileged dark_factory field through", async () => {
    const pool = makePool();

    pool.query
      .mockResolvedValueOnce({
        rows: [{ full_name: "re-cinq/lore", team: null }],
      })
      .mockResolvedValue({ rows: [] });
    const res = await put(
      { settings: { dark_factory: { review: "never" } } },
      pool,
    );

    expect(res.statusCode).toBe(200);
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

  it("returns 400 for a dark_factory patch it cannot even parse", async () => {
    const pool = makePool();

    pool.query.mockResolvedValue({
      rows: [{ full_name: "re-cinq/lore", team: null }],
    });
    const res = await put(
      { settings: { dark_factory: { review: "whenever-i-feel-like-it" } } },
      pool,
    );

    expect(res.statusCode).toBe(400);
  });

  it("returns 400 when the patch names no field to update", async () => {
    const pool = makePool();

    pool.query.mockResolvedValue({
      rows: [{ full_name: "re-cinq/lore", team: null }],
    });

    expect((await put({}, pool)).statusCode).toBe(400);
  });
});
