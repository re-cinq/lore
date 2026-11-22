import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { encryptTokenPair } from "./token-cipher.js";
import { personGithubEnv } from "./person-github-env.js";
import { freshAccessToken } from "./user-token-refresh.js";

const KEY = "0123456789abcdef".repeat(4);
const NOW = new Date("2026-11-22T10:00:00Z");
const MINUTE_MS = 60_000;
const OLD_PAIR = { accessToken: "ghu_old", refreshToken: "ghr_old" };
const NEW_PAIR = {
  accessToken: "ghu_new",
  expiresIn: 28800,
  refreshToken: "ghr_new",
  refreshTokenExpiresIn: 15897600,
};

interface StoredRow {
  encryptedTokens: string;
  accessTokenExpiresAt: Date | null;
  refreshTokenExpiresAt: Date | null;
}

function rowExpiringIn(minutes: number | null): StoredRow {
  return {
    encryptedTokens: encryptTokenPair(OLD_PAIR, KEY),
    accessTokenExpiresAt:
      minutes === null ? null : new Date(NOW.getTime() + minutes * MINUTE_MS),
    refreshTokenExpiresAt: new Date("2027-05-01T00:00:00Z"),
  };
}

function poolHolding(readings: StoredRow[]) {
  const events: string[] = [];
  const updates: unknown[][] = [];
  const remaining = [...readings];
  const run = async (sql: string, params: unknown[] = []) => {
    const statement = sql.trim().split(/\s+/).slice(0, 2).join(" ");

    if (sql.includes("FROM pipeline.user_session_tokens")) {
      events.push(sql.includes("FOR UPDATE") ? "read locked" : "read");

      return { rows: [remaining.shift() ?? readings.at(-1)] };
    }

    if (sql.includes("UPDATE pipeline.user_session_tokens")) {
      updates.push(params);
    }
    events.push(statement);

    return { rows: [] };
  };
  const client = { query: vi.fn(run), release: vi.fn() };
  const pool = {
    query: vi.fn(run),
    connect: vi.fn(async () => client),
  } as unknown as Pool;

  return { pool, events, updates };
}

const statusOf = (attempt: Promise<unknown>) =>
  attempt.then(
    () => 200,
    (err: { output: { statusCode: number } }) => err.output.statusCode,
  );

async function refusalWithoutReading() {
  const { pool, events } = poolHolding([rowExpiringIn(60)]);
  const status = await statusOf(freshAccessToken(pool, "s-1", vi.fn()));

  return { status, events };
}

describe("freshAccessToken", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
    process.env.LORE_USER_TOKEN_ENCRYPTION_KEY = KEY;
    process.env.GITHUB_APP_CLIENT_ID = "Iv1.client";
    process.env.GITHUB_APP_CLIENT_SECRET = "client-secret";
  });

  afterEach(() => {
    vi.useRealTimers();
    delete process.env.LORE_USER_TOKEN_ENCRYPTION_KEY;
    delete process.env.GITHUB_APP_CLIENT_ID;
    delete process.env.GITHUB_APP_CLIENT_SECRET;
  });

  it("answers the stored access token and asks GitHub for nothing when it expires in 6 minutes", async () => {
    const { pool, events } = poolHolding([rowExpiringIn(6)]);
    const refresh = vi.fn();

    expect({
      token: await freshAccessToken(pool, "s-1", refresh),
      events,
      refreshes: refresh.mock.calls.length,
    }).toEqual({ token: "ghu_old", events: ["read"], refreshes: 0 });
  });

  it("locks the token row, then calls GitHub with the stored refresh token, then replaces both tokens and both expiries in one transaction when the access token expires in 4 minutes", async () => {
    const { pool, events, updates } = poolHolding([rowExpiringIn(4)]);
    const refresh = vi.fn(async () => {
      events.push("github");

      return NEW_PAIR;
    });

    const token = await freshAccessToken(pool, "s-1", refresh);

    expect({
      token,
      events,
      refreshedWith: refresh.mock.calls,
      updated: [updates[0]?.[0], updates[0]?.[2], updates[0]?.[3]],
    }).toEqual({
      token: "ghu_new",
      events: [
        "read",
        "BEGIN",
        "read locked",
        "github",
        "UPDATE pipeline.user_session_tokens",
        "COMMIT",
      ],
      refreshedWith: [
        [
          {
            clientId: "Iv1.client",
            clientSecret: "client-secret",
            refreshToken: "ghr_old",
          },
        ],
      ],
      updated: [
        "s-1",
        new Date("2026-11-22T18:00:00Z"),
        new Date("2027-05-25T10:00:00Z"),
      ],
    });
  });

  it("stores a pair GitHub answered with both tokens sealed under the key", async () => {
    const { pool, updates } = poolHolding([rowExpiringIn(null)]);

    await freshAccessToken(pool, "s-1", async () => NEW_PAIR);

    expect(updates[0]?.[1]).toEqual(
      expect.stringMatching(/^v1:[\w-]+:[\w-]+:[\w-]+$/),
    );
  });

  it("uses the pair another request stored while it waited for the lock and calls GitHub for nothing", async () => {
    const { pool, events } = poolHolding([
      rowExpiringIn(2),
      rowExpiringIn(470),
    ]);
    const refresh = vi.fn();

    expect({
      token: await freshAccessToken(pool, "s-1", refresh),
      events,
      refreshes: refresh.mock.calls.length,
    }).toEqual({
      token: "ghu_old",
      events: ["read", "BEGIN", "read locked", "COMMIT"],
      refreshes: 0,
    });
  });

  it("refuses with 503, rolls back and stores nothing when GitHub gives no new pair", async () => {
    const { pool, events, updates } = poolHolding([rowExpiringIn(1)]);
    const outcome = await freshAccessToken(pool, "s-1", async () => null).then(
      () => 200,
      (err: { output: { statusCode: number } }) => err.output.statusCode,
    );

    expect({ outcome, updates, events }).toEqual({
      outcome: 503,
      updates: [],
      events: ["read", "BEGIN", "read locked", "ROLLBACK"],
    });
  });

  it("refreshes a stored pair that records no access token expiry", async () => {
    const { pool } = poolHolding([rowExpiringIn(null)]);

    expect(await freshAccessToken(pool, "s-1", async () => NEW_PAIR)).toBe(
      "ghu_new",
    );
  });

  it("refuses with 503 and stores nothing when GitHub's pair lacks a refresh token or a lifetime", async () => {
    const outcomes: unknown[] = [];

    for (const pair of [
      { accessToken: "ghu_new", expiresIn: 28800 },
      { accessToken: "ghu_new", refreshToken: "ghr_new" },
    ]) {
      const { pool, updates } = poolHolding([rowExpiringIn(1)]);
      const status = await statusOf(
        freshAccessToken(pool, "s-1", async () => pair),
      );

      outcomes.push({ status, updates });
    }

    expect(outcomes).toEqual([
      { status: 503, updates: [] },
      { status: 503, updates: [] },
    ]);
  });

  it("refuses with 503 and reads nothing when the GitHub App client secret is not configured", async () => {
    delete process.env.GITHUB_APP_CLIENT_SECRET;

    expect(await refusalWithoutReading()).toEqual({
      status: 503,
      events: [],
    });
  });

  it("refuses with 503 and reads nothing when the GitHub App client id is not configured", async () => {
    delete process.env.GITHUB_APP_CLIENT_ID;

    expect(await refusalWithoutReading()).toEqual({
      status: 503,
      events: [],
    });
  });

  it("refuses with 503 and reads nothing when the token encryption key is not configured", async () => {
    delete process.env.LORE_USER_TOKEN_ENCRYPTION_KEY;

    expect(await refusalWithoutReading()).toEqual({
      status: 503,
      events: [],
    });
  });

  it("refuses with 401 when the session holds no stored token row", async () => {
    const pool = {
      query: vi.fn(async () => ({ rows: [] })),
    } as unknown as Pool;

    expect(await statusOf(freshAccessToken(pool, "s-1", vi.fn()))).toBe(401);
  });

  it("refuses with 401, rolls back and calls GitHub for nothing when the row is gone under the lock", async () => {
    const events: string[] = [];
    const run = async (sql: string) => {
      if (sql.includes("FROM pipeline.user_session_tokens")) {
        const locked = sql.includes("FOR UPDATE");

        events.push(locked ? "read locked" : "read");

        return { rows: locked ? [] : [rowExpiringIn(1)] };
      }
      events.push(sql.trim().split(/\s+/)[0] ?? "");

      return { rows: [] };
    };
    const client = { query: vi.fn(run), release: vi.fn() };
    const pool = {
      query: vi.fn(run),
      connect: vi.fn(async () => client),
    } as unknown as Pool;
    const refresh = vi.fn();
    const status = await statusOf(freshAccessToken(pool, "s-1", refresh));

    expect({ status, events, refreshes: refresh.mock.calls.length }).toEqual({
      status: 401,
      events: ["read", "BEGIN", "read locked", "ROLLBACK"],
      refreshes: 0,
    });
  });
});

describe("personGithubEnv", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
    process.env.LORE_USER_TOKEN_ENCRYPTION_KEY = KEY;
    process.env.GITHUB_APP_CLIENT_ID = "Iv1.client";
    process.env.GITHUB_APP_CLIENT_SECRET = "client-secret";
    process.env.GITHUB_APP_ID = "999";
    process.env.GITHUB_APP_PRIVATE_KEY = "app-key";
    process.env.GITHUB_APP_INSTALLATION_ID = "42";
  });

  afterEach(() => {
    vi.useRealTimers();

    for (const name of [
      "LORE_USER_TOKEN_ENCRYPTION_KEY",
      "GITHUB_APP_CLIENT_ID",
      "GITHUB_APP_CLIENT_SECRET",
      "GITHUB_APP_ID",
      "GITHUB_APP_PRIVATE_KEY",
      "GITHUB_APP_INSTALLATION_ID",
    ]) {
      delete process.env[name];
    }
  });

  function poolOfSessions(sessionIds: string[], tokenRow: StoredRow) {
    const { pool: tokenPool } = poolHolding([tokenRow]);
    const query = vi.fn(async (sql: string, params: unknown[] = []) =>
      sql.includes("FROM pipeline.api_tokens")
        ? { rows: sessionIds.map((id) => ({ id })) }
        : tokenPool.query(sql, params),
    );

    return { ...tokenPool, query } as unknown as Pool;
  }

  it("acts with the session's stored access token and no App credentials when a person's token is not due", async () => {
    const env = await personGithubEnv(
      poolOfSessions(["s-1"], rowExpiringIn(60)),
      { person: true, tokenHash: "hash-1" },
    );

    expect({
      token: env?.GITHUB_TOKEN,
      appCredentials: [
        env?.GITHUB_APP_ID,
        env?.GITHUB_APP_PRIVATE_KEY,
        env?.GITHUB_APP_INSTALLATION_ID,
      ],
    }).toEqual({
      token: "ghu_old",
      appCredentials: [undefined, undefined, undefined],
    });
  });

  it("acts with the access token GitHub refreshed and no App credentials when a person's token is due", async () => {
    const originalFetch = globalThis.fetch;
    const bodies: unknown[] = [];

    globalThis.fetch = (async (_url: unknown, init?: { body?: string }) => {
      bodies.push(JSON.parse(init?.body ?? "{}"));

      return Response.json({
        access_token: "ghu_new",
        expires_in: 28800,
        refresh_token: "ghr_new",
        refresh_token_expires_in: 15897600,
      });
    }) as typeof fetch;

    try {
      const env = await personGithubEnv(
        poolOfSessions(["s-1"], rowExpiringIn(1)),
        { person: true, tokenHash: "hash-1" },
      );

      expect({
        token: env?.GITHUB_TOKEN,
        refreshTokensSent: bodies.map(
          (body) => (body as { refresh_token: string }).refresh_token,
        ),
        appCredentials: [
          env?.GITHUB_APP_ID,
          env?.GITHUB_APP_PRIVATE_KEY,
          env?.GITHUB_APP_INSTALLATION_ID,
        ],
      }).toEqual({
        token: "ghu_new",
        refreshTokensSent: ["ghr_old"],
        appCredentials: [undefined, undefined, undefined],
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("refuses with the signed-in person's GitHub token is not available when the token hash matches no session", async () => {
    const outcome = await personGithubEnv(
      poolOfSessions([], rowExpiringIn(60)),
      { person: true, tokenHash: "unknown-hash" },
    ).then(
      () => "acted",
      (err: Error) => err.message,
    );

    expect(outcome).toBe(
      "the signed-in person's GitHub token is not available",
    );
  });
});
