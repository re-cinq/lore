import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { buildServer } from "../../../app/build-server.js";
import {
  makePool,
  useRateLimitSafeClock,
  AUTH,
  LEGACY_TOKEN,
} from "@re-cinq/lore-server-core/test-helpers/http-mock.js";

const originalEnv = { ...process.env };

function req(
  opts: { method: "GET" | "POST" | "PUT"; body?: unknown; query?: string },
  pool: unknown = makePool(),
) {
  const payload = serializedPayload(opts.body);

  return buildServer(() => pool as any).inject({
    method: opts.method,
    url: "/api/tokens" + (opts.query ?? ""),
    headers: AUTH,
    payload,
  });
}

function serializedPayload(requestBody: unknown): string | undefined {
  if (requestBody === undefined) {
    return undefined;
  }

  return typeof requestBody === "string"
    ? requestBody
    : JSON.stringify(requestBody);
}

function insertParameters(pool: ReturnType<typeof makePool>): unknown[] {
  const insertCall = [
    ...pool.query.mock.calls,
    ...pool.__client.query.mock.calls,
  ].find(([sql]) => String(sql).includes("INSERT INTO pipeline.api_tokens"));

  return insertCall?.[1] ?? [];
}

describe("/api/tokens", () => {
  useRateLimitSafeClock();
  beforeEach(() => {
    process.env.LORE_INGEST_TOKEN = LEGACY_TOKEN;
  });
  afterEach(() => {
    process.env = { ...originalEnv };
    vi.clearAllMocks();
  });

  it("returns 503 when pool is null", async () => {
    const res = await req({ method: "GET" }, null);

    expect(res.statusCode).toBe(503);
  });

  it("lists active tokens on GET with paging metadata", async () => {
    const pool = makePool();

    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 1, name: "ci" }] })
      .mockResolvedValueOnce({ rows: [{ total: 1 }] });
    const res = await req({ method: "GET" }, pool);

    expect(res.result).toEqual({
      tokens: [{ id: 1, name: "ci" }],
      total: 1,
      limit: 20,
      offset: 0,
    });
    expect(pool.query.mock.calls[0][1]).toEqual([20, 0]);
  });

  it("clamps over-max limit and applies offset on GET", async () => {
    const pool = makePool();

    pool.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ total: 0 }] });
    await req({ method: "GET", query: "?limit=999&offset=5" }, pool);
    expect(pool.query.mock.calls[0][1]).toEqual([100, 5]);
  });

  it("returns 400 for a negative offset on GET", async () => {
    const res = await req({ method: "GET", query: "?offset=-1" }, makePool());

    expect(res.statusCode).toBe(400);
  });

  it("revokes a token on POST", async () => {
    const pool = makePool();

    pool.query.mockResolvedValue({});
    const res = await req(
      { method: "POST", body: { action: "revoke", token_id: "x" } },
      pool,
    );

    expect(res.result).toEqual({ ok: true });
  });

  it("returns 400 when creating without a name", async () => {
    const res = await req({ method: "POST", body: {} }, makePool());

    expect(res.statusCode).toBe(400);
  });

  it("returns 400 when the POST body is entirely absent", async () => {
    const res = await req({ method: "POST" }, makePool());

    expect(res.statusCode).toBe(400);
  });

  it("creates a token, filtering invalid scopes and computing expiry", async () => {
    const pool = makePool();

    pool.query.mockResolvedValue({
      rows: [{ id: 9, name: "ci", scopes: ["read"], created_at: "now" }],
    });
    const res = await req(
      {
        method: "POST",
        body: { name: "ci", scopes: ["read", "bogus"], expires_in_days: 30 },
      },
      pool,
    );

    expect(res.statusCode).toBe(201);
    const body = res.result as { token: string; expires_at: string | null };

    expect(body.token).toMatch(/^lore_[0-9a-f]{64}$/);
    expect(body.expires_at).not.toBeNull();
  });

  it("creates a token with default scope and no expiry", async () => {
    const pool = makePool();

    pool.query.mockResolvedValue({ rows: [{ id: 10, name: "ci" }] });
    const res = await req({ method: "POST", body: { name: "ci" } }, pool);

    expect((res.result as { expires_at: string | null }).expires_at).toBeNull();
  });

  it("attributes a token minted with no signed-in person to admin", async () => {
    const pool = makePool();

    pool.query.mockResolvedValue({ rows: [{ id: 11, name: "ci" }] });
    await req({ method: "POST", body: { name: "ci" } }, pool);

    expect(insertParameters(pool)[3]).toBe("admin");
  });

  it("records the signed-in person's login as created_by when they mint a token", async () => {
    const pool = makePool();

    pool.query.mockImplementation(async (sql: string) => ({
      rows: sql.includes("UPDATE pipeline.api_tokens SET last_used")
        ? [
            {
              id: 1,
              scopes: ["admin"],
              kind: "user",
              login: "alice",
              displayName: "Alice",
              avatarUrl: null,
              repos: [],
              github_id: 987654,
              reposRefreshedAt: new Date("2026-11-22T00:00:00Z"),
              startedAt: new Date("2026-11-22T00:00:00Z"),
              expiresAt: null,
            },
          ]
        : [{ id: 12, name: "ci" }],
    }));
    await buildServer(() => pool as any).inject({
      method: "POST",
      url: "/api/tokens",
      headers: { authorization: "Bearer session-token" },
      payload: JSON.stringify({ name: "ci" }),
    });

    expect(insertParameters(pool)[3]).toBe("alice");
  });

  it("refuses kind emergency with 400 and inserts nothing", async () => {
    const pool = makePool();

    const res = await req(
      { method: "POST", body: { name: "ops", kind: "emergency" } },
      pool,
    );

    expect({ status: res.statusCode, insert: insertParameters(pool) }).toEqual({
      status: 400,
      insert: [],
    });
  });

  it("returns 500 when the insert throws", async () => {
    const pool = makePool();

    pool.query.mockRejectedValue(new Error("insert fail"));
    const res = await req({ method: "POST", body: { name: "ci" } }, pool);

    expect(res.statusCode).toBe(500);
  });

  describe("called with a person's session", () => {
    const SESSION = { authorization: "Bearer lore_session" };
    const SESSION_NOW = new Date("2026-11-20T10:00:00Z");
    const SESSION_EXPIRES = new Date("2026-11-20T18:00:00Z");

    beforeEach(() => {
      vi.useFakeTimers({ now: SESSION_NOW, toFake: ["Date"] });
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    function sessionPool() {
      const pool = makePool();

      pool.query.mockResolvedValue({
        rows: [
          {
            id: "s-1",
            scopes: ["admin"],
            kind: "user",
            github_id: "4242",
            login: "gedaiu",
            displayName: "Bogdan",
            avatarUrl: "https://a/1",
            repos: ["re-cinq/lore"],
            reposRefreshedAt: SESSION_NOW,
            startedAt: SESSION_NOW,
            expiresAt: SESSION_EXPIRES,
          },
        ],
      });
      pool.__client.query.mockImplementation(async (sql: string) => ({
        rows: sql.includes("INSERT") ? [{ id: "t-9", name: "ci" }] : [],
      }));

      return pool;
    }

    function mintWithSession(pool: ReturnType<typeof makePool>) {
      return buildServer(() => pool as any).inject({
        method: "POST",
        url: "/api/tokens",
        headers: SESSION,
        payload: JSON.stringify({ name: "ci" }),
      });
    }

    it("takes the person's advisory lock before it stores the token and records the person as its maker", async () => {
      const pool = sessionPool();

      const res = await mintWithSession(pool);
      const statements = pool.__client.query.mock.calls.map(([sql]: string[]) =>
        sql.trim().split(/\s+/).slice(0, 3).join(" "),
      );
      const insert = pool.__client.query.mock.calls.find(([sql]: string[]) =>
        sql.includes("INSERT INTO pipeline.api_tokens"),
      );

      expect({
        status: res.statusCode,
        statements,
        lockParams: pool.__client.query.mock.calls[1][1],
        makerId: insert?.[1].at(-2),
      }).toEqual({
        status: 201,
        statements: [
          "BEGIN",
          "SELECT pg_advisory_xact_lock($1::bigint)",
          "INSERT INTO pipeline.api_tokens",
          "COMMIT",
        ],
        lockParams: [4242],
        makerId: 4242,
      });
    });

    it("stores no token when the insert fails and rolls the transaction back", async () => {
      const pool = sessionPool();

      pool.__client.query.mockImplementation(async (sql: string) => {
        enforceTrue(!sql.includes("INSERT"), Error, "insert fail");

        return { rows: [] };
      });
      const res = await mintWithSession(pool);

      expect({
        status: res.statusCode,
        rolledBack: pool.__client.query.mock.calls.some(
          ([sql]: string[]) => sql === "ROLLBACK",
        ),
      }).toEqual({ status: 500, rolledBack: true });
    });
  });

  it("returns 405 for unsupported methods", async () => {
    const res = await req({ method: "PUT", body: {} }, makePool());

    expect(res.statusCode).toBe(405);
  });
});
