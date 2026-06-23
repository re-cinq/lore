import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { handleApiRoute } from "../routes.js";
import { makeReq, makeRes, makePool, makeOctokit, useRateLimitSafeClock, AUTH, LEGACY_TOKEN } from "@re-cinq/lore-server-core/test-helpers/http-mock.js";

vi.mock("../../features/dark-factory/dark-factory-settings.js", () => ({
  parseDarkFactorySettings: vi.fn((b: unknown) => b),
  parseTaskOverrides: vi.fn((b: unknown) => b),
  resolveSettings: vi.fn((p: unknown) => ({ resolved: true, partial: p })),
  twoKeyFieldsTouched: vi.fn(() => [] as string[]),
}));
vi.mock("../../features/dark-factory/dark-factory-authz.js", () => {
  class TwoKeyError extends Error {
    constructor(
      message: string,
      public readonly code: string,
    ) {
      super(message);
    }
  }
  return { verifyApproval: vi.fn(), TwoKeyError };
});
vi.mock("../../platform/github-client.js", () => ({ getOctokit: vi.fn(), getGitHubToken: vi.fn() }));

// GET now resolves via the Project facade (projectFor → settings.resolveOrNull).
const fakeSettings = { resolveOrNull: vi.fn() };
vi.mock("../../platform/project-boot.js", () => ({ projectFor: vi.fn(async () => ({ settings: fakeSettings })) }));

import { parseDarkFactorySettings, resolveSettings, twoKeyFieldsTouched } from "../../features/dark-factory/dark-factory-settings.js";
import { verifyApproval, TwoKeyError } from "../../features/dark-factory/dark-factory-authz.js";
import { getOctokit } from "../../platform/github-client.js";

const URL_BASE = "/api/repos/o/r/settings/dark-factory";
const originalEnv = { ...process.env };

/** Wire the txn client's query by SQL fragment. */
function clientQueries(pool: ReturnType<typeof makePool>, over: Record<string, unknown> = {}) {
  const defaults: Record<string, unknown> = {
    "FOR UPDATE": { rows: [{ settings: {} }] },
  };
  const map = { ...defaults, ...over };
  pool.__client.query.mockImplementation((sql: string) => {
    for (const [frag, result] of Object.entries(map)) {
      if (sql.includes(frag)) {
        return result instanceof Error ? Promise.reject(result) : Promise.resolve(result);
      }
    }
    return Promise.resolve({});
  });
}

describe("routes — dark-factory settings", () => {
  useRateLimitSafeClock();
  beforeEach(() => {
    process.env.LORE_INGEST_TOKEN = LEGACY_TOKEN;
    vi.mocked(twoKeyFieldsTouched).mockReturnValue([]);
    vi.mocked(parseDarkFactorySettings).mockImplementation((b: unknown) => b as any);
    vi.mocked(resolveSettings).mockImplementation((p: unknown) => ({ resolved: true, partial: p }) as any);
  });
  afterEach(() => {
    process.env = { ...originalEnv };
    vi.clearAllMocks();
  });

  it("returns 503 when pool is null", async () => {
    const res = makeRes();
    await handleApiRoute(makeReq({ url: URL_BASE, headers: AUTH }), res, null);
    expect(res.statusCode).toBe(503);
  });

  it("returns 405 for unsupported methods", async () => {
    const pool = makePool();
    const res = makeRes();
    await handleApiRoute(makeReq({ url: URL_BASE, method: "DELETE", headers: AUTH }), res, pool as any);
    expect(res.statusCode).toBe(405);
  });

  it("returns 405 when the method is absent", async () => {
    const pool = makePool();
    const res = makeRes();
    await handleApiRoute(makeReq({ url: URL_BASE, method: "", headers: AUTH }), res, pool as any);
    expect(res.statusCode).toBe(405);
  });

  // ── GET ───────────────────────────────────────────────────────────
  describe("GET", () => {
    it("returns 404 when the repo is not onboarded", async () => {
      fakeSettings.resolveOrNull.mockResolvedValue(null);
      const pool = makePool();
      const res = makeRes();
      await handleApiRoute(makeReq({ url: URL_BASE, headers: AUTH }), res, pool as any);
      expect(res.json).toEqual({ error: "repo not onboarded", repo: "o/r" });
    });
    it("returns the resolved dark_factory settings", async () => {
      fakeSettings.resolveOrNull.mockResolvedValue({ resolved: true, partial: { enabled: true } });
      const pool = makePool();
      const res = makeRes();
      await handleApiRoute(makeReq({ url: URL_BASE, headers: AUTH }), res, pool as any);
      expect(res.json).toEqual({ resolved: true, partial: { enabled: true } });
    });
    it("returns 500 when resolution throws", async () => {
      fakeSettings.resolveOrNull.mockRejectedValue(new Error("db"));
      const pool = makePool();
      const res = makeRes();
      await handleApiRoute(makeReq({ url: URL_BASE, headers: AUTH }), res, pool as any);
      expect(res.json).toEqual({ error: "internal" });
    });
  });

  // ── PUT ───────────────────────────────────────────────────────────
  describe("PUT", () => {
    function put(body: unknown, headers: Record<string, string> = {}, pool = makePool()) {
      const res = makeRes();
      return handleApiRoute(
        makeReq({ url: URL_BASE, method: "PUT", headers: { ...AUTH, ...headers }, body }),
        res,
        pool as any,
      ).then(() => ({ res, pool }));
    }

    it("returns 400 on invalid JSON", async () => {
      const { res } = await put("{bad");
      expect(res.statusCode).toBe(400);
      expect(res.json.error).toBe("invalid_body");
    });

    it("returns 400 when the body exceeds the 1MB limit", async () => {
      const { res } = await put("x".repeat(1_048_577));
      expect(res.statusCode).toBe(400);
      expect(res.json.error).toBe("invalid_body");
    });

    it("returns 400 with issues when schema validation fails", async () => {
      vi.mocked(parseDarkFactorySettings).mockImplementation(() => {
        throw { issues: [{ path: "enabled" }] };
      });
      const { res } = await put({ enabled: "nope" });
      expect(res.json).toEqual({ error: "invalid_settings", issues: [{ path: "enabled" }] });
    });

    it("returns 400 with the message when a plain error is thrown", async () => {
      vi.mocked(parseDarkFactorySettings).mockImplementation(() => {
        throw new Error("bad shape");
      });
      const { res } = await put({ enabled: "nope" });
      expect(res.json).toEqual({ error: "invalid_settings", issues: "bad shape" });
    });

    it("applies an admin-tier change and writes the audit log", async () => {
      const pool = makePool();
      clientQueries(pool);
      const { res } = await put({ review: "auto" }, {}, pool);
      expect(res.json).toMatchObject({ ok: true, applied: { review: "auto" }, ceremony: { tier: "admin" } });
    });

    it("merges the nested auto_merge object", async () => {
      const pool = makePool();
      clientQueries(pool, { "FOR UPDATE": { rows: [{ settings: { dark_factory: { auto_merge: { paths: ["x"] } } } }] } });
      const { res } = await put({ auto_merge: { min_trust: "full" } }, {}, pool);
      expect(res.json.applied.auto_merge).toEqual({ paths: ["x"], min_trust: "full" });
    });

    it("merges auto_merge when there is no prior auto_merge and null settings", async () => {
      const pool = makePool();
      clientQueries(pool, { "FOR UPDATE": { rows: [{ settings: null }] } });
      const { res } = await put({ auto_merge: { min_trust: "full" } }, {}, pool);
      expect(res.json.applied.auto_merge).toEqual({ min_trust: "full" });
    });

    it("returns 403 when a two-key field lacks the approval header", async () => {
      vi.mocked(twoKeyFieldsTouched).mockReturnValue(["enabled"]);
      const { res } = await put({ enabled: true });
      expect(res.statusCode).toBe(403);
      expect(res.json.error).toBe("two_key_required");
    });

    it("two-key gates a per-task-type execution.image change", async () => {
      vi.mocked(twoKeyFieldsTouched).mockReturnValue([
        "task_overrides.implementation.execution.image",
      ]);
      const { res } = await put({
        task_overrides: { implementation: { execution: { image: "golang:1.23" } } },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json.error).toBe("two_key_required");
      expect(res.json.field_paths).toContain(
        "task_overrides.implementation.execution.image",
      );
    });

    it("applies a two-key change after CODEOWNERS approval", async () => {
      vi.mocked(twoKeyFieldsTouched).mockReturnValue(["enabled"]);
      vi.mocked(getOctokit).mockResolvedValue(makeOctokit() as any);
      vi.mocked(verifyApproval).mockResolvedValue({ prRef: "#5", approver: "alice", prUrl: "https://gh/5" } as any);
      const pool = makePool();
      clientQueries(pool);
      const { res } = await put({ enabled: true }, { "x-lore-approval-pr": "#5" }, pool);
      expect(res.json.ceremony).toEqual({ tier: "two_key", pr_ref: "#5", approver: "alice", pr_url: "https://gh/5" });
    });

    it("returns 403 on a CODEOWNERS check failure", async () => {
      vi.mocked(twoKeyFieldsTouched).mockReturnValue(["enabled"]);
      vi.mocked(getOctokit).mockResolvedValue(makeOctokit() as any);
      vi.mocked(verifyApproval).mockRejectedValue(new TwoKeyError("nope", "approver_not_codeowner"));
      const { res } = await put({ enabled: true }, { "x-lore-approval-pr": "#5" });
      expect(res.json).toMatchObject({ error: "codeowners_check_failed", code: "approver_not_codeowner" });
    });

    it("returns 503 when the approval check hits a GitHub error", async () => {
      vi.mocked(twoKeyFieldsTouched).mockReturnValue(["enabled"]);
      vi.mocked(getOctokit).mockResolvedValue(makeOctokit() as any);
      vi.mocked(verifyApproval).mockRejectedValue(new Error("api down"));
      const { res } = await put({ enabled: true }, { "x-lore-approval-pr": "#5" });
      expect(res.json).toEqual({ error: "github_api_unavailable" });
    });

    it("returns 404 when the repo vanishes inside the transaction", async () => {
      const pool = makePool();
      clientQueries(pool, { "FOR UPDATE": { rows: [] } });
      const { res } = await put({ review: "auto" }, {}, pool);
      expect(res.json).toEqual({ error: "repo not onboarded", repo: "o/r" });
    });

    it("commits even when the audit-log insert fails", async () => {
      const pool = makePool();
      clientQueries(pool, { audit_log: new Error("audit fail") });
      const { res } = await put({ review: "auto" }, {}, pool);
      expect(res.json).toMatchObject({ ok: true });
    });

    it("rolls back and returns 500 on a write failure", async () => {
      const pool = makePool();
      clientQueries(pool, { "UPDATE lore.repos": new Error("write fail") });
      const { res } = await put({ review: "auto" }, {}, pool);
      expect(res.json).toEqual({ error: "internal" });
      expect(pool.__client.query).toHaveBeenCalledWith("ROLLBACK");
    });

    it("swallows a failing rollback after a write failure", async () => {
      const pool = makePool();
      clientQueries(pool, { "UPDATE lore.repos": new Error("write fail"), ROLLBACK: new Error("rollback fail") });
      const { res } = await put({ review: "auto" }, {}, pool);
      expect(res.json).toEqual({ error: "internal" });
    });
  });
});
