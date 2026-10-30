import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("../../../outbound/project-boot.js", () => ({ projectFor: vi.fn() }));
vi.mock(
  "@re-cinq/lore-shared/project/github-installations/lore-app-login.js",
  () => ({ loreAppLogin: vi.fn() }),
);

import { buildServer } from "../../../app/build-server.js";
import { projectFor } from "../../../outbound/project-boot.js";
import { loreAppLogin } from "@re-cinq/lore-shared/project/github-installations/lore-app-login.js";
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

  it("GET lists implementation, review, merge and digest off and triage, upkeep and tickets on for a repo with empty settings", async () => {
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
      ["merge", "Auto merge", false],
      ["triage", "Issue triage", true],
      ["upkeep", "Spec upkeep", true],
      ["digest", "Daily digest", false],
      ["tickets", "Spec tickets", true],
    ]);
  });

  it("GET reads each switch from its own settings key", async () => {
    const res = await get(
      poolWithRepo({
        implementation_loop: { enabled: true },
        auto_review: true,
        auto_merge: { enabled: true, min_age_hours: 6 },
        issue_triage: { enabled: false },
        spec_upkeep: { enabled: false },
        digest: { enabled: true },
        spec_tickets: { enabled: false },
      }),
    );

    expect(
      JSON.parse(res.payload).loops.map((l: { enabled: boolean }) => l.enabled),
    ).toEqual([true, true, true, false, false, true, false]);
  });

  it("GET shows a paused implementation loop as switched on", async () => {
    const res = await get(
      poolWithRepo({
        implementation_loop: { enabled: true },
        loop_pauses: {
          implementation: {
            reason: "model credit exhausted",
            run_id: "run-1",
            at: "2026-10-30T10:00:00.000Z",
            until: null,
          },
        },
      }),
    );

    expect(JSON.parse(res.payload).loops[0]).toMatchObject({
      key: "implementation",
      enabled: true,
      paused: { reason: "model credit exhausted", run_id: "run-1" },
    });
  });

  it("PUT implementation on forgets the implementation pause", async () => {
    const pool = poolWithRepo();

    await put("implementation", { enabled: true }, pool);
    const resume = pool.query.mock.calls.find(([sql]) =>
      String(sql).includes("#- ARRAY['loop_pauses'"),
    );

    expect(resume?.[1]).toEqual(["re-cinq/lore", "implementation"]);
  });

  it("PUT review off leaves the review pause alone", async () => {
    const pool = poolWithRepo();

    await put("review", { enabled: false }, pool);

    expect(
      pool.query.mock.calls.some(([sql]) => String(sql).includes("#-")),
    ).toBe(false);
  });

  it("DELETE review pause forgets it and echoes the key", async () => {
    const pool = poolWithRepo();

    const res = await buildServer(() => pool as never).inject({
      method: "DELETE",
      url: "/api/repos/re-cinq/lore/loops/review/pause",
      headers: AUTH,
    });
    const resume = pool.query.mock.calls.find(([sql]) =>
      String(sql).includes("#- ARRAY['loop_pauses'"),
    );

    expect({
      status: res.statusCode,
      body: JSON.parse(res.payload),
      params: resume?.[1],
    }).toEqual({
      status: 200,
      body: { ok: true, key: "review", rerun_run_id: null },
      params: ["re-cinq/lore", "review"],
    });
  });

  it("DELETE a pause on a repo with no row answers 404", async () => {
    const res = await buildServer(() => makePool() as never).inject({
      method: "DELETE",
      url: "/api/repos/re-cinq/lore/loops/review/pause",
      headers: AUTH,
    });

    expect(res.statusCode).toBe(404);
  });

  it("PUT upkeep off writes spec_upkeep.enabled false", async () => {
    const pool = poolWithRepo();

    const res = await put("upkeep", { enabled: false }, pool);
    const update = pool.query.mock.calls.find(([sql]) =>
      String(sql).includes("UPDATE lore.repos"),
    );

    expect({
      status: res.statusCode,
      block: /'spec_upkeep'/.test(String(update?.[0])),
      params: update?.[1],
    }).toEqual({ status: 200, block: true, params: ["re-cinq/lore", false] });
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
    expect((await put("changelog", { enabled: true })).statusCode).toBe(400);
    expect((await put("triage", { enabled: "yes" })).statusCode).toBe(400);
  });

  it("PUT merge on writes auto_merge.enabled with no approval asked", async () => {
    const pool = poolWithRepo();

    const res = await put("merge", { enabled: true }, pool);
    const updates = pool.query.mock.calls.filter(([sql]) =>
      String(sql).includes("UPDATE lore.repos"),
    );

    expect({
      status: res.statusCode,
      switched: /'auto_merge'/.test(String(updates[0]?.[0])),
      params: updates.map(([, params]) => params),
    }).toEqual({
      status: 200,
      switched: true,
      params: [
        ["re-cinq/lore", true],
        ["re-cinq/lore", "merge"],
      ],
    });
  });

  it("PUT merge off writes auto_merge.enabled false and takes back the auto-merge Lore armed on its own open pull request", async () => {
    const pool = poolWithRepo();
    const cancelled: string[] = [];

    vi.mocked(projectFor).mockResolvedValue({
      pulls: {
        list: async () => [
          { number: 7, nodeId: "PR_7", author: "lore[bot]", autoMerge: true },
          { number: 8, nodeId: "PR_8", author: "someone", autoMerge: true },
        ],
        cancelAutoMerge: async (nodeId: string) => {
          cancelled.push(nodeId);
        },
      },
      audit: { write: async () => {} },
    } as never);
    vi.mocked(loreAppLogin).mockResolvedValue("lore[bot]");

    const res = await put("merge", { enabled: false }, pool);
    const update = pool.query.mock.calls.find(([sql]) =>
      String(sql).includes("UPDATE lore.repos"),
    );

    expect({
      body: JSON.parse(res.payload),
      sql: /'auto_merge'/.test(String(update?.[0])),
      params: update?.[1],
      cancelled,
    }).toEqual({
      body: { ok: true, key: "merge", enabled: false },
      sql: true,
      params: ["re-cinq/lore", false],
      cancelled: ["PR_7"],
    });
  });

  it("PUT merge on for a repo with no row answers 404 without asking GitHub anything", async () => {
    const res = await put("merge", { enabled: true });

    expect({
      status: res.statusCode,
      github: vi.mocked(projectFor).mock.calls,
    }).toEqual({
      status: 404,
      github: [],
    });
  });

  it("PUT merge off still answers 200 when GitHub cannot list the pull requests to disarm", async () => {
    const pool = poolWithRepo();

    vi.mocked(projectFor).mockRejectedValue(new Error("github down"));

    const res = await put("merge", { enabled: false }, pool);

    expect({ status: res.statusCode, body: JSON.parse(res.payload) }).toEqual({
      status: 200,
      body: { ok: true, key: "merge", enabled: false },
    });
  });
});
