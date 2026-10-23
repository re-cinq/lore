import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("../../../outbound/project-boot.js", () => ({ projectFor: vi.fn() }));

import { buildServer } from "../../../app/build-server.js";
import { projectFor } from "../../../outbound/project-boot.js";
import {
  makePool,
  useRateLimitSafeClock,
  AUTH,
  LEGACY_TOKEN,
} from "@re-cinq/lore-server-core/test-helpers/http-mock.js";

const originalEnv = { ...process.env };

describe("/api/repos/{owner}/{repo}/loops", () => {
  useRateLimitSafeClock();
  beforeEach(() => {
    process.env.LORE_INGEST_TOKEN = LEGACY_TOKEN;
  });
  afterEach(() => {
    process.env = { ...originalEnv };
    vi.clearAllMocks();
  });

  function get(pool: unknown = makePool()) {
    return buildServer(() => pool as never).inject({
      method: "GET",
      url: "/api/repos/re-cinq/lore/loops",
      headers: AUTH,
    });
  }

  function put(key: string, payload: unknown, pool: unknown = makePool()) {
    return buildServer(() => pool as never).inject({
      method: "PUT",
      url: `/api/repos/re-cinq/lore/loops/${key}`,
      headers: AUTH,
      payload: JSON.stringify(payload),
    });
  }

  function poolWithRepo(settings: unknown = {}) {
    const pool = makePool();

    pool.query
      .mockResolvedValueOnce({
        rows: [{ full_name: "re-cinq/lore", settings }],
      })
      .mockResolvedValue({ rows: [] });

    return pool;
  }

  it("returns 503 when the pool is null", async () => {
    expect((await get(null)).statusCode).toBe(503);
    expect((await put("triage", { enabled: true }, null)).statusCode).toBe(503);
  });

  it("returns 404 for a repo with no row", async () => {
    expect((await get()).statusCode).toBe(404);
    expect((await put("triage", { enabled: false })).statusCode).toBe(404);
  });

  it("GET lists implementation and review off and triage on for a repo with empty settings", async () => {
    const res = await get(poolWithRepo({}));

    expect(
      JSON.parse(res.payload).loops.map(
        (l: { key: string; label: string; enabled: boolean }) => [
          l.key,
          l.label,
          l.enabled,
        ],
      ),
    ).toEqual([
      ["implementation", "Implementation loop", false],
      ["review", "Code review", false],
      ["triage", "Issue triage", true],
    ]);
  });

  it("GET reads each switch from its own settings key", async () => {
    const res = await get(
      poolWithRepo({
        implementation_loop: { enabled: true },
        auto_review: true,
        issue_triage: { enabled: false },
      }),
    );

    expect(
      JSON.parse(res.payload).loops.map((l: { enabled: boolean }) => l.enabled),
    ).toEqual([true, true, false]);
  });

  it("PUT triage off writes issue_triage.enabled under admin scope and echoes the state", async () => {
    const pool = poolWithRepo();

    const res = await put("triage", { enabled: false }, pool);

    const update = pool.query.mock.calls.find(([sql]) =>
      String(sql).includes("UPDATE lore.repos"),
    );

    expect({
      body: JSON.parse(res.payload),
      updateParams: update?.[1],
    }).toEqual({
      body: { ok: true, key: "triage", enabled: false },
      updateParams: ["re-cinq/lore", false],
    });
    expect(projectFor).not.toHaveBeenCalled();
  });

  it("PUT implementation on writes implementation_loop.enabled and seeds the priority and lore:blocked labels", async () => {
    const pool = poolWithRepo();
    const seeded: Array<{ name: string }> = [];

    vi.mocked(projectFor).mockResolvedValue({
      issues: {
        createLabels: async (labels: Array<{ name: string }>) => {
          seeded.push(...labels);
        },
      },
    } as never);

    const res = await put("implementation", { enabled: true }, pool);
    const update = pool.query.mock.calls.find(([sql]) =>
      String(sql).includes("UPDATE lore.repos"),
    );

    expect({
      body: JSON.parse(res.payload),
      updateParams: update?.[1],
      seeded: seeded.map((l) => l.name),
    }).toEqual({
      body: { ok: true, key: "implementation", enabled: true },
      updateParams: ["re-cinq/lore", true],
      seeded: [
        "priority:high",
        "priority:medium",
        "priority:low",
        "lore:blocked",
      ],
    });
  });

  it("PUT review on writes the top-level auto_review flag", async () => {
    const pool = poolWithRepo();

    const res = await put("review", { enabled: true }, pool);
    const update = pool.query.mock.calls.find(([sql]) =>
      String(sql).includes("UPDATE lore.repos"),
    );

    expect({
      body: JSON.parse(res.payload),
      sql: /jsonb_build_object\('auto_review', \$2::boolean\)/.test(
        String(update?.[0]),
      ),
      updateParams: update?.[1],
    }).toEqual({
      body: { ok: true, key: "review", enabled: true },
      sql: true,
      updateParams: ["re-cinq/lore", true],
    });
  });

  it("PUT implementation off seeds nothing", async () => {
    const res = await put("implementation", { enabled: false }, poolWithRepo());

    expect(res.statusCode).toBe(200);
    expect(projectFor).not.toHaveBeenCalled();
  });

  it("a label-seeding failure does not fail the switch write", async () => {
    vi.mocked(projectFor).mockRejectedValue(new Error("github down"));

    const res = await put("implementation", { enabled: true }, poolWithRepo());

    expect(res.statusCode).toBe(200);
  });

  it("PUT rejects a key no loop has and a payload without a boolean enabled", async () => {
    expect((await put("merge", { enabled: true })).statusCode).toBe(400);
    expect((await put("triage", { enabled: "yes" })).statusCode).toBe(400);
  });
});
