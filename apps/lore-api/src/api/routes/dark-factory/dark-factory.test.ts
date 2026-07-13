import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { buildServer } from "../../../server/build-server.js";
import {
  makePool,
  makeOctokit,
  useRateLimitSafeClock,
  AUTH,
  LEGACY_TOKEN,
} from "@re-cinq/lore-server-core/test-helpers/http-mock.js";

// Partial mock: spread the real module (so DarkFactorySettingsSchema and the other
// re-exports the OpenAPI generator lifts stay defined) and override only the parse
// functions this suite drives.
vi.mock(
  "../../../features/dark-factory/dark-factory-settings.js",
  async (importActual) => ({
    ...(await importActual<
      typeof import("../../../features/dark-factory/dark-factory-settings.js")
    >()),
    parseDarkFactorySettings: vi.fn((b: unknown) => b),
    parseTaskOverrides: vi.fn((b: unknown) => b),
    resolveSettings: vi.fn((p: unknown) => ({ resolved: true, partial: p })),
    twoKeyFieldsTouched: vi.fn(() => [] as string[]),
  }),
);
vi.mock("../../../features/dark-factory/dark-factory-authz.js", () => {
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
vi.mock("../../../platform/github-client.js", () => ({
  getOctokit: vi.fn(),
  getGitHubToken: vi.fn(),
}));

// GET resolves via the Project facade (projectFor → settings.resolveOrNull).
const fakeSettings = { resolveOrNull: vi.fn() };

vi.mock("../../../platform/project-boot.js", () => ({
  projectFor: vi.fn(async () => ({ settings: fakeSettings })),
}));

import {
  parseDarkFactorySettings,
  resolveSettings,
  twoKeyFieldsTouched,
} from "../../../features/dark-factory/dark-factory-settings.js";
import {
  verifyApproval,
  TwoKeyError,
} from "../../../features/dark-factory/dark-factory-authz.js";
import { getOctokit } from "../../../platform/github-client.js";

const URL_BASE = "/api/repos/o/r/settings/dark-factory";
const originalEnv = { ...process.env };

/** Wire the txn client's query by SQL fragment. */
function clientQueries(
  pool: ReturnType<typeof makePool>,
  over: Record<string, unknown> = {},
) {
  const map: Record<string, unknown> = {
    "FOR UPDATE": { rows: [{ settings: {} }] },
    ...over,
  };

  pool.__client.query.mockImplementation((sql: string) => {
    for (const [frag, result] of Object.entries(map)) {
      if (sql.includes(frag)) {
        return result instanceof Error
          ? Promise.reject(result)
          : Promise.resolve(result);
      }
    }

    return Promise.resolve({});
  });
}

const get = (pool: unknown) =>
  buildServer(() => pool as any).inject({
    method: "GET",
    url: URL_BASE,
    headers: AUTH,
  });

describe("routes — dark-factory settings", () => {
  useRateLimitSafeClock();
  beforeEach(() => {
    process.env.LORE_INGEST_TOKEN = LEGACY_TOKEN;
    vi.mocked(twoKeyFieldsTouched).mockReturnValue([]);
    vi.mocked(parseDarkFactorySettings).mockImplementation(
      (b: unknown) => b as any,
    );
    vi.mocked(resolveSettings).mockImplementation(
      (p: unknown) => ({ resolved: true, partial: p }) as any,
    );
  });
  afterEach(() => {
    process.env = { ...originalEnv };
    vi.clearAllMocks();
  });

  it("returns 503 when pool is null", async () => {
    const res = await get(null);

    expect(res.statusCode).toBe(503);
  });

  it("returns 405 for unsupported methods", async () => {
    const res = await buildServer(() => makePool() as any).inject({
      method: "DELETE",
      url: URL_BASE,
      headers: AUTH,
    });

    expect(res.statusCode).toBe(405);
  });

  describe("GET", () => {
    it("returns 404 when the repo is not onboarded", async () => {
      fakeSettings.resolveOrNull.mockResolvedValue(null);
      const res = await get(makePool());

      expect(res.result).toEqual({ error: "repo not onboarded", repo: "o/r" });
    });
    it("returns the resolved dark_factory settings", async () => {
      fakeSettings.resolveOrNull.mockResolvedValue({
        resolved: true,
        partial: { enabled: true },
      });
      const res = await get(makePool());

      expect(res.result).toEqual({
        resolved: true,
        partial: { enabled: true },
      });
    });
    it("returns 500 when resolution throws", async () => {
      fakeSettings.resolveOrNull.mockRejectedValue(new Error("db"));
      const res = await get(makePool());

      expect(res.result).toEqual({ error: "internal" });
    });
  });

  describe("PUT", () => {
    function put(
      body: unknown,
      headers: Record<string, string> = {},
      pool = makePool(),
    ) {
      const payload = typeof body === "string" ? body : JSON.stringify(body);

      return buildServer(() => pool as any).inject({
        method: "PUT",
        url: URL_BASE,
        headers: { ...AUTH, ...headers },
        payload,
      });
    }

    it("returns 400 on invalid JSON", async () => {
      // ADR-034: hapi parses the payload, so malformed JSON is a 400 (hapi's
      // native parse-error body) before the handler runs.
      const res = await put("{bad");

      expect(res.statusCode).toBe(400);
    });

    it("returns 413 when the body exceeds the 1MB limit", async () => {
      // ADR-034: the body cap is hapi's native payload.maxBytes now → 413.
      const res = await put("x".repeat(1_048_577));

      expect(res.statusCode).toBe(413);
    });

    it("returns 400 with issues when schema validation fails", async () => {
      vi.mocked(parseDarkFactorySettings).mockImplementation(() => {
        throw { issues: [{ path: "enabled" }] };
      });
      const res = await put({ enabled: "nope" });

      expect(res.result).toEqual({
        error: "invalid_settings",
        issues: [{ path: "enabled" }],
      });
    });

    it("returns 400 with the message when a plain error is thrown", async () => {
      vi.mocked(parseDarkFactorySettings).mockImplementation(() => {
        throw new Error("bad shape");
      });
      const res = await put({ enabled: "nope" });

      expect(res.result).toEqual({
        error: "invalid_settings",
        issues: "bad shape",
      });
    });

    it("applies an admin-tier change and writes the audit log", async () => {
      const pool = makePool();

      clientQueries(pool);
      const res = await put({ review: "auto" }, {}, pool);

      expect(res.result).toMatchObject({
        ok: true,
        applied: { review: "auto" },
        ceremony: { tier: "admin" },
      });
    });

    it("merges the nested auto_merge object", async () => {
      const pool = makePool();

      clientQueries(pool, {
        "FOR UPDATE": {
          rows: [
            { settings: { dark_factory: { auto_merge: { paths: ["x"] } } } },
          ],
        },
      });
      const res = await put({ auto_merge: { min_trust: "full" } }, {}, pool);

      expect(
        (res.result as { applied: { auto_merge: unknown } }).applied.auto_merge,
      ).toEqual({ paths: ["x"], min_trust: "full" });
    });

    it("merges auto_merge when there is no prior auto_merge and null settings", async () => {
      const pool = makePool();

      clientQueries(pool, { "FOR UPDATE": { rows: [{ settings: null }] } });
      const res = await put({ auto_merge: { min_trust: "full" } }, {}, pool);

      expect(
        (res.result as { applied: { auto_merge: unknown } }).applied.auto_merge,
      ).toEqual({ min_trust: "full" });
    });

    it("returns 403 when a two-key field lacks the approval header", async () => {
      vi.mocked(twoKeyFieldsTouched).mockReturnValue(["enabled"]);
      const res = await put({ enabled: true });

      expect(res.statusCode).toBe(403);
      expect((res.result as { error: string }).error).toBe("two_key_required");
    });

    it("two-key gates a per-task-type execution.image change", async () => {
      vi.mocked(twoKeyFieldsTouched).mockReturnValue([
        "task_overrides.implementation.execution.image",
      ]);
      const res = await put({
        task_overrides: {
          implementation: { execution: { image: "golang:1.23" } },
        },
      });

      expect(res.statusCode).toBe(403);
      expect(res.result).toMatchObject({
        error: "two_key_required",
        field_paths: ["task_overrides.implementation.execution.image"],
      });
    });

    it("applies a two-key change after CODEOWNERS approval", async () => {
      vi.mocked(twoKeyFieldsTouched).mockReturnValue(["enabled"]);
      vi.mocked(getOctokit).mockResolvedValue(makeOctokit() as any);
      vi.mocked(verifyApproval).mockResolvedValue({
        prRef: "#5",
        approver: "alice",
        prUrl: "https://gh/5",
      } as any);
      const pool = makePool();

      clientQueries(pool);
      const res = await put(
        { enabled: true },
        { "x-lore-approval-pr": "#5" },
        pool,
      );

      expect((res.result as { ceremony: unknown }).ceremony).toEqual({
        tier: "two_key",
        pr_ref: "#5",
        approver: "alice",
        pr_url: "https://gh/5",
      });
    });

    it("returns 403 on a CODEOWNERS check failure", async () => {
      vi.mocked(twoKeyFieldsTouched).mockReturnValue(["enabled"]);
      vi.mocked(getOctokit).mockResolvedValue(makeOctokit() as any);
      vi.mocked(verifyApproval).mockRejectedValue(
        new TwoKeyError("nope", "approver_not_codeowner"),
      );
      const res = await put({ enabled: true }, { "x-lore-approval-pr": "#5" });

      expect(res.result).toMatchObject({
        error: "codeowners_check_failed",
        code: "approver_not_codeowner",
      });
    });

    it("returns 503 when the approval check hits a GitHub error", async () => {
      vi.mocked(twoKeyFieldsTouched).mockReturnValue(["enabled"]);
      vi.mocked(getOctokit).mockResolvedValue(makeOctokit() as any);
      vi.mocked(verifyApproval).mockRejectedValue(new Error("api down"));
      const res = await put({ enabled: true }, { "x-lore-approval-pr": "#5" });

      expect(res.result).toEqual({ error: "github_api_unavailable" });
    });

    it("returns 404 when the repo vanishes inside the transaction", async () => {
      const pool = makePool();

      clientQueries(pool, { "FOR UPDATE": { rows: [] } });
      const res = await put({ review: "auto" }, {}, pool);

      expect(res.result).toEqual({ error: "repo not onboarded", repo: "o/r" });
    });

    it("commits even when the audit-log insert fails", async () => {
      const pool = makePool();

      clientQueries(pool, { audit_log: new Error("audit fail") });
      const res = await put({ review: "auto" }, {}, pool);

      expect(res.result).toMatchObject({ ok: true });
    });

    it("rolls back and returns 500 on a write failure", async () => {
      const pool = makePool();

      clientQueries(pool, { "UPDATE lore.repos": new Error("write fail") });
      const res = await put({ review: "auto" }, {}, pool);

      expect(res.result).toEqual({ error: "internal" });
      expect(pool.__client.query).toHaveBeenCalledWith("ROLLBACK");
    });

    it("swallows a failing rollback after a write failure", async () => {
      const pool = makePool();

      clientQueries(pool, {
        "UPDATE lore.repos": new Error("write fail"),
        ROLLBACK: new Error("rollback fail"),
      });
      const res = await put({ review: "auto" }, {}, pool);

      expect(res.result).toEqual({ error: "internal" });
    });
  });
});
