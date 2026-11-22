import { randomBytes, randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { buildServer } from "../../../app/build-server.js";

const ENCRYPTION_KEY = randomBytes(32).toString("base64");
const RETURN_URL = "https://lore.example/auth/callback";
const FIXED_NOW_MS = new Date("2026-11-21T12:00:00.000Z").getTime();

const ORIGINAL_ENV = { ...process.env };
const ORIGINAL_FETCH = globalThis.fetch;

type TokenExchangePayload =
  | {
      access_token: string;
      expires_in?: number;
      refresh_token?: string;
      refresh_token_expires_in?: number;
      token_type?: string;
      scope?: string;
    }
  | { error: string };

interface HandoffPoolState {
  handoffs: Map<string, Record<string, unknown>>;
  apiTokens: Array<Record<string, unknown>>;
  sessionTokens: Array<Record<string, unknown>>;
  cleanupSweeps: number;
  txSnapshot: {
    handoffs: Map<string, Record<string, unknown>>;
    apiTokens: Array<Record<string, unknown>>;
    sessionTokens: Array<Record<string, unknown>>;
  } | null;
}

describe("GitHub App sign-in hardening (FR-431 to FR-028)", () => {
  beforeEach(() => {
    vi.useFakeTimers({
      now: FIXED_NOW_MS,
      toFake: ["Date", "setInterval", "clearInterval"],
    });
    configureAppSignInEnv();
  });

  afterEach(() => {
    vi.useRealTimers();
    globalThis.fetch = ORIGINAL_FETCH;
    process.env = { ...ORIGINAL_ENV };
  });

  it("refuses an already-redeemed code and an expired code without creating a session or a token row", async () => {
    const pool = createAuthPool();
    const server = buildServer(() => pool.asPool());

    try {
      installGithubFetchStub();

      const firstCode = await completeCallbackForCode(server);
      const firstRedeem = await redeemWithCode(server, firstCode);
      const replayRedeem = await redeemWithCode(server, firstCode);

      expect({
        firstStatus: firstRedeem.statusCode,
        replayStatus: replayRedeem.statusCode,
        replayBody: JSON.parse(replayRedeem.payload),
      }).toEqual({
        firstStatus: 200,
        replayStatus: 401,
        replayBody: { error: "invalid or used code" },
      });

      const secondCode = await completeCallbackForCode(server);
      const expiredState = await startLogin(server);

      vi.setSystemTime(new Date(FIXED_NOW_MS + 11 * 60_000));

      const expiredRedeem = await redeemWithCode(server, secondCode);
      const expiredCallback = await server.inject(
        `/api/auth/callback?code=gh-code&state=${encodeURIComponent(expiredState)}`,
      );

      expect({
        expiredRedeemStatus: expiredRedeem.statusCode,
        expiredRedeemBody: JSON.parse(expiredRedeem.payload),
        expiredCallbackStatus: expiredCallback.statusCode,
        expiredCallbackBody: JSON.parse(expiredCallback.payload),
      }).toEqual({
        expiredRedeemStatus: 401,
        expiredRedeemBody: { error: "invalid or used code" },
        expiredCallbackStatus: 400,
        expiredCallbackBody: { error: "sign-in expired, start again" },
      });
      expect({
        apiTokenCount: pool.apiTokenCount(),
        sessionTokenCount: pool.sessionTokenCount(),
      }).toEqual({
        apiTokenCount: 1,
        sessionTokenCount: 1,
      });
    } finally {
      await server.stop();
    }
  });

  it("deletes expired login_handoffs rows and their encrypted token pairs on a once-a-minute timer without any new sign-in", async () => {
    const pool = createAuthPool();
    const server = buildServer(() => pool.asPool());

    try {
      installGithubFetchStub();
      await completeCallbackForCode(server);

      const beforeExpiryHandoffs = pool.handoffSnapshot();
      const sweepsBeforeAdvance = pool.cleanupSweepCount();

      await vi.advanceTimersByTimeAsync(5 * 60_000);

      const stillLiveHandoffs = pool.handoffCount();

      await vi.advanceTimersByTimeAsync(6 * 60_000);

      expect(beforeExpiryHandoffs).toEqual({
        count: 1,
        allHaveEncryptedTokens: true,
      });
      expect(stillLiveHandoffs).toBe(1);
      expect({
        handoffCountAfterExpiry: pool.handoffCount(),
        cleanupSweepsRun: pool.cleanupSweepCount() - sweepsBeforeAdvance >= 1,
      }).toEqual({
        handoffCountAfterExpiry: 0,
        cleanupSweepsRun: true,
      });
    } finally {
      await server.stop();
    }
  });

  it("changes nothing when the cleanup timer runs twice or across two server replicas at once", async () => {
    const pool = createAuthPool();
    const replicaA = buildServer(() => pool.asPool());
    const replicaB = buildServer(() => pool.asPool());

    try {
      installGithubFetchStub();
      await completeCallbackForCode(replicaA);

      await vi.advanceTimersByTimeAsync(5 * 60_000);

      const freshCode = await completeCallbackForCode(replicaB);
      const countWhileBothLive = pool.handoffCount();

      await vi.advanceTimersByTimeAsync(7 * 60_000);

      const countAfterFirstSweep = pool.handoffCount();

      await vi.advanceTimersByTimeAsync(60_000);

      const countAfterSecondSweep = pool.handoffCount();
      const redeemFresh = await redeemWithCode(replicaB, freshCode);

      expect({
        countWhileBothLive,
        countAfterFirstSweep,
        countAfterSecondSweep,
      }).toEqual({
        countWhileBothLive: 2,
        countAfterFirstSweep: 1,
        countAfterSecondSweep: 1,
      });
      expect({
        redeemStatus: redeemFresh.statusCode,
        tokenPrefix: (redeemFresh.result as { token: string }).token.slice(
          0,
          5,
        ),
        apiTokenCount: pool.apiTokenCount(),
        sessionTokenCount: pool.sessionTokenCount(),
        remainingHandoffs: pool.handoffCount(),
      }).toEqual({
        redeemStatus: 200,
        tokenPrefix: "lore_",
        apiTokenCount: 1,
        sessionTokenCount: 1,
        remainingHandoffs: 0,
      });
    } finally {
      await replicaA.stop();
      await replicaB.stop();
    }
  });

  it("refuses sign-in when GitHub returns no expiry or no refresh token and creates no session", async () => {
    const pool = createAuthPool();
    const server = buildServer(() => pool.asPool());

    try {
      const noExpiryError = await callbackErrorForToken(server, {
        access_token: "ghu_no_expiry",
        refresh_token: "ghr_valid_1",
        refresh_token_expires_in: 15897600,
        token_type: "bearer",
      });
      const zeroExpiryError = await callbackErrorForToken(server, {
        access_token: "ghu_zero_expiry",
        expires_in: 0,
        refresh_token: "ghr_valid_2",
        refresh_token_expires_in: 15897600,
        token_type: "bearer",
      });
      const noRefreshError = await callbackErrorForToken(server, {
        access_token: "ghu_no_refresh",
        expires_in: 28800,
        token_type: "bearer",
      });

      expect({
        noExpiryError,
        zeroExpiryError,
        noRefreshError,
      }).toEqual({
        noExpiryError: { authError: "github_denied", code: null },
        zeroExpiryError: { authError: "github_denied", code: null },
        noRefreshError: { authError: "github_denied", code: null },
      });
      expect({
        handoffCount: pool.handoffCount(),
        apiTokenCount: pool.apiTokenCount(),
        sessionTokenCount: pool.sessionTokenCount(),
      }).toEqual({
        handoffCount: 0,
        apiTokenCount: 0,
        sessionTokenCount: 0,
      });
    } finally {
      await server.stop();
    }
  });

  it("refuses sign-in when GitHub answers a negative expiry, an expiry that is not a number or an empty refresh token, and creates no session", async () => {
    const pool = createAuthPool();
    const server = buildServer(() => pool.asPool());

    try {
      const negativeExpiry = await callbackErrorForToken(server, {
        access_token: "ghu_negative_expiry",
        expires_in: -28800,
        refresh_token: "ghr_valid_3",
      });
      const stringExpiry = await callbackErrorForToken(server, {
        access_token: "ghu_string_expiry",
        expires_in: "28800" as unknown as number,
        refresh_token: "ghr_valid_4",
      });
      const emptyRefresh = await callbackErrorForToken(server, {
        access_token: "ghu_empty_refresh",
        expires_in: 28800,
        refresh_token: "",
      });

      expect({ negativeExpiry, stringExpiry, emptyRefresh }).toEqual({
        negativeExpiry: { authError: "github_denied", code: null },
        stringExpiry: { authError: "github_denied", code: null },
        emptyRefresh: { authError: "github_denied", code: null },
      });
      expect({
        handoffCount: pool.handoffCount(),
        apiTokenCount: pool.apiTokenCount(),
        sessionTokenCount: pool.sessionTokenCount(),
      }).toEqual({
        handoffCount: 0,
        apiTokenCount: 0,
        sessionTokenCount: 0,
      });
    } finally {
      await server.stop();
    }
  });

  it("keeps sweeping after a cleanup whose database call fails, so an expired row still goes", async () => {
    const pool = createAuthPool();
    const inner = pool.asPool();
    let failNextSweep = false;
    const flakyQuery = async (sql: string, params?: unknown[]) => {
      if (
        failNextSweep &&
        sql.includes("DELETE FROM lore.login_handoffs") &&
        !sql.includes("RETURNING")
      ) {
        failNextSweep = false;
        throw new Error("connection reset");
      }

      return (inner.query as unknown as (s: string, p?: unknown[]) => unknown)(
        sql,
        params,
      );
    };
    const flakyPool = { ...inner, query: flakyQuery } as unknown as Pool;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const server = buildServer(() => flakyPool);

    try {
      installGithubFetchStub();
      await completeCallbackForCode(server);

      await vi.advanceTimersByTimeAsync(9 * 60_000);
      failNextSweep = true;
      await vi.advanceTimersByTimeAsync(60_000);

      const afterFailedSweep = {
        failed: !failNextSweep,
        handoffs: pool.handoffCount(),
      };

      await vi.advanceTimersByTimeAsync(60_000);

      expect({
        afterFailedSweep,
        handoffsAfterNextSweep: pool.handoffCount(),
      }).toEqual({
        afterFailedSweep: { failed: true, handoffs: 1 },
        handoffsAfterNextSweep: 0,
      });
    } finally {
      warn.mockRestore();
      await server.stop();
    }
  });

  it("refuses sign-in through the OAuth App and creates no session after the upgrade", async () => {
    const pool = createAuthPool();
    const server = buildServer(() => pool.asPool());

    try {
      const oauthTokenResult = await callbackErrorForToken(server, {
        access_token: "gho_oauth_app_token",
        token_type: "bearer",
        scope: "read:org,repo",
      });
      const authorizeUrl = await startLoginUrl(server);

      delete process.env.GITHUB_APP_CLIENT_ID;
      delete process.env.GITHUB_APP_CLIENT_SECRET;

      const loginWithoutApp = await server.inject(
        `/api/auth/login?return=${encodeURIComponent(RETURN_URL)}`,
      );
      const callbackWithoutApp = await server.inject(
        "/api/auth/callback?code=gh-code&state=any-state",
      );

      expect({
        oauthTokenResult,
        loginClientId: authorizeUrl.searchParams.get("client_id"),
      }).toEqual({
        oauthTokenResult: { authError: "github_denied", code: null },
        loginClientId: "Iv1.app-client-1",
      });
      expect({
        loginStatus: loginWithoutApp.statusCode,
        callbackStatus: callbackWithoutApp.statusCode,
      }).toEqual({
        loginStatus: 503,
        callbackStatus: 503,
      });
      expect({
        handoffCount: pool.handoffCount(),
        apiTokenCount: pool.apiTokenCount(),
        sessionTokenCount: pool.sessionTokenCount(),
      }).toEqual({
        handoffCount: 1,
        apiTokenCount: 0,
        sessionTokenCount: 0,
      });
    } finally {
      await server.stop();
    }
  });
});

async function callbackErrorForToken(
  server: ReturnType<typeof buildServer>,
  tokenPayload: TokenExchangePayload,
) {
  installGithubFetchStub(tokenPayload);

  const state = await startLogin(server);
  const callbackRes = await server.inject(
    `/api/auth/callback?code=gh-code&state=${encodeURIComponent(state)}`,
  );
  const location = new URL(String(callbackRes.headers.location));

  return {
    authError: location.searchParams.get("auth_error"),
    code: location.searchParams.get("code"),
  };
}

async function completeCallbackForCode(
  server: ReturnType<typeof buildServer>,
): Promise<string> {
  const state = await startLogin(server);
  const callbackRes = await server.inject(
    `/api/auth/callback?code=gh-code&state=${encodeURIComponent(state)}`,
  );
  const location = new URL(String(callbackRes.headers.location));

  return location.searchParams.get("code") ?? "";
}

async function startLogin(
  server: ReturnType<typeof buildServer>,
): Promise<string> {
  const authorizeUrl = await startLoginUrl(server);

  return authorizeUrl.searchParams.get("state") ?? "";
}

async function startLoginUrl(
  server: ReturnType<typeof buildServer>,
): Promise<URL> {
  const res = await server.inject(
    `/api/auth/login?return=${encodeURIComponent(RETURN_URL)}`,
  );

  return new URL(String(res.headers.location));
}

function redeemWithCode(server: ReturnType<typeof buildServer>, code: string) {
  return server.inject({
    method: "POST",
    url: "/api/auth/redeem",
    payload: { code },
  });
}

function configureAppSignInEnv(): void {
  process.env.GITHUB_APP_ID = "99999";
  process.env.GITHUB_APP_INSTALLATION_ID = "12345";
  process.env.GITHUB_APP_CLIENT_ID = "Iv1.app-client-1";
  process.env.GITHUB_APP_CLIENT_SECRET = "app-secret-1";
  process.env.GITHUB_OAUTH_CLIENT_ID = "oauth-client-1";
  process.env.GITHUB_OAUTH_CLIENT_SECRET = "oauth-secret-1";
  process.env.LORE_API_URL = "https://lore-api.example";
  process.env.LORE_UI_URL = "https://lore.example";
  process.env.GITHUB_ORG = "re-cinq";
  process.env.LORE_USER_TOKEN_ENCRYPTION_KEY = ENCRYPTION_KEY;
}

function installGithubFetchStub(
  tokenPayload: TokenExchangePayload = {
    access_token: "ghu_access_valid",
    expires_in: 28800,
    refresh_token: "ghr_refresh_valid",
    refresh_token_expires_in: 15897600,
    token_type: "bearer",
  },
): void {
  globalThis.fetch = async (input) =>
    routeGithubStubFetch(String(input), tokenPayload);
}

function routeGithubStubFetch(
  url: string,
  tokenPayload: TokenExchangePayload,
): Response {
  if (url === "https://github.com/login/oauth/access_token") {
    return jsonResponse(tokenPayload);
  }

  if (url === "https://api.github.com/user") {
    return jsonResponse({
      id: 4242,
      login: "gedaiu",
      name: "Bogdan",
      avatar_url: "https://a/1",
    });
  }

  if (url === "https://api.github.com/user/memberships/orgs/re-cinq") {
    return jsonResponse({ state: "active", role: "admin" });
  }

  if (
    url ===
    "https://api.github.com/user/installations/12345/repositories?per_page=100"
  ) {
    return jsonResponse({
      repositories: [
        { full_name: "re-cinq/lore", owner: { login: "re-cinq" } },
      ],
    });
  }

  return jsonResponse({ message: `unexpected URL ${url}` }, 404);
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function createAuthPool() {
  const state: HandoffPoolState = {
    handoffs: new Map(),
    apiTokens: [],
    sessionTokens: [],
    cleanupSweeps: 0,
    txSnapshot: null,
  };
  const query = async (sql: string, params: unknown[] = []) =>
    dispatchPoolSql(state, sql, params);
  const client = { query, release: () => {} };
  const pool = {
    query,
    connect: async () => client,
  } as unknown as Pool;

  return {
    asPool: () => pool,
    handoffCount: () => state.handoffs.size,
    cleanupSweepCount: () => state.cleanupSweeps,
    apiTokenCount: () => state.apiTokens.length,
    sessionTokenCount: () => state.sessionTokens.length,
    handoffSnapshot: () => ({
      count: state.handoffs.size,
      allHaveEncryptedTokens: [...state.handoffs.values()].every(
        (entry) =>
          typeof entry.encrypted_tokens === "string" &&
          entry.encrypted_tokens.length > 0,
      ),
    }),
  };
}

const TX_SQL = new Set(["BEGIN", "COMMIT", "ROLLBACK"]);

function dispatchPoolSql(
  state: HandoffPoolState,
  sql: string,
  params: unknown[],
) {
  if (TX_SQL.has(sql)) {
    return handleTxSql(state, sql);
  }

  if (sql.includes("lore.login_handoffs")) {
    return executeHandoffSql(state, sql, params);
  }

  if (sql.includes("INSERT INTO")) {
    return dispatchInsertSql(state, sql, params);
  }

  return { rows: [] };
}

function dispatchInsertSql(
  state: HandoffPoolState,
  sql: string,
  params: unknown[],
) {
  if (sql.includes("user_session_tokens")) {
    return insertSessionToken(state.sessionTokens, sql, params);
  }

  if (sql.includes("api_tokens")) {
    return insertApiToken(state.apiTokens, sql, params);
  }

  return { rows: [] };
}

function handleTxSql(state: HandoffPoolState, sql: string) {
  if (sql === "BEGIN") {
    state.txSnapshot = {
      handoffs: new Map(state.handoffs),
      apiTokens: [...state.apiTokens],
      sessionTokens: [...state.sessionTokens],
    };

    return { rows: [] };
  }

  if (sql === "ROLLBACK" && state.txSnapshot) {
    state.handoffs = state.txSnapshot.handoffs;
    state.apiTokens = state.txSnapshot.apiTokens;
    state.sessionTokens = state.txSnapshot.sessionTokens;
  }

  state.txSnapshot = null;

  return { rows: [] };
}

function executeHandoffSql(
  state: HandoffPoolState,
  sql: string,
  params: unknown[],
) {
  if (sql.includes("INSERT INTO lore.login_handoffs")) {
    return insertHandoffRow(state.handoffs, sql, params);
  }

  if (
    sql.includes("DELETE FROM lore.login_handoffs") &&
    sql.includes("RETURNING")
  ) {
    return takeHandoffRow(state.handoffs, params);
  }

  if (sql.includes("DELETE FROM lore.login_handoffs")) {
    return sweepExpiredHandoffs(state);
  }

  return { rows: [] };
}

function sweepExpiredHandoffs(state: HandoffPoolState) {
  state.cleanupSweeps += 1;

  for (const [key, entry] of state.handoffs.entries()) {
    const expiresAt = entry.expires_at as Date;

    if (expiresAt.getTime() <= Date.now()) {
      state.handoffs.delete(key);
    }
  }

  return { rows: [] };
}

function insertHandoffRow(
  handoffs: Map<string, Record<string, unknown>>,
  sql: string,
  params: unknown[],
) {
  const columns = parseInsertColumns(sql, "lore.login_handoffs");
  const entry = mapColumns(columns, params);

  handoffs.set(String(entry.code_hash), entry);

  return { rows: [] };
}

function takeHandoffRow(
  handoffs: Map<string, Record<string, unknown>>,
  params: unknown[],
) {
  const key = String(params[0]);
  const phase = String(params[1]);
  const entry = handoffs.get(key);

  if (!entry || entry.phase !== phase) {
    return { rows: [] };
  }

  const expiresAt = entry.expires_at as Date;

  if (expiresAt.getTime() <= Date.now()) {
    return { rows: [] };
  }

  handoffs.delete(key);

  return {
    rows: [
      {
        returnUrl: entry.return_url,
        grant: JSON.parse(String(entry.grant_json)),
        encryptedTokens: entry.encrypted_tokens ?? null,
        generation: entry.generation ?? null,
      },
    ],
  };
}

function insertApiToken(
  apiTokens: Array<Record<string, unknown>>,
  sql: string,
  params: unknown[],
) {
  const columns = parseInsertColumns(sql, "pipeline.api_tokens");
  const entry = mapColumns(columns, params);
  const id = randomUUID();

  entry.id = id;
  apiTokens.push(entry);

  return {
    rows: [
      {
        id,
        name: entry.name,
        scopes: entry.scopes ?? [],
        created_at: new Date(FIXED_NOW_MS),
      },
    ],
  };
}

function insertSessionToken(
  sessionTokens: Array<Record<string, unknown>>,
  sql: string,
  params: unknown[],
) {
  const columns = parseInsertColumns(sql, "pipeline.user_session_tokens");
  const entry = mapColumns(columns, params);

  sessionTokens.push(entry);

  return { rows: [] };
}

function parseInsertColumns(sql: string, tableName: string): string[] {
  const tableIndex = sql.indexOf(tableName);

  if (tableIndex === -1) {
    return [];
  }

  const openParen = sql.indexOf("(", tableIndex + tableName.length);
  const closeParen = sql.indexOf(")", openParen + 1);

  if (openParen === -1 || closeParen === -1) {
    return [];
  }

  return sql
    .slice(openParen + 1, closeParen)
    .split(",")
    .map((col) => col.trim());
}

function mapColumns(
  columns: string[],
  params: unknown[],
): Record<string, unknown> {
  const entry: Record<string, unknown> = {};

  columns.forEach((col, index) => {
    entry[col] = params[index];
  });

  return entry;
}
