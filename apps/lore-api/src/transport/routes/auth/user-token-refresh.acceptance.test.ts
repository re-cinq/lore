import { randomBytes, randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { makePool } from "@re-cinq/lore-server-core/test-helpers/http-mock.js";
import { setPool } from "@re-cinq/lore-server-core/platform/db.js";
import { buildServer } from "../../../app/build-server.js";
import { onSessionEnded } from "../../../work/auth/session-ended.js";
import { decryptTokenPair } from "../../../work/auth/token-cipher.js";
import { freshAccessToken } from "../../../work/auth/user-token-refresh.js";

const API_URL = "https://lore-api.example.com";
const UI_URL = "https://lore-ui.example.com";
const GITHUB_ORG = "acme";
const INSTALLATION_ID = "42";
const ENCRYPTION_KEY = randomBytes(32).toString("base64");
const BASE_NOW_MS = new Date("2026-11-22T10:00:00.000Z").getTime();
const INITIAL_ACCESS_TOKEN = "ghu_initial_session_access";
const INITIAL_REFRESH_TOKEN = "ghr_initial_session_refresh";

const ORIGINAL_ENV = { ...process.env };
const ORIGINAL_FETCH = globalThis.fetch;

type RefreshHandler = (
  body: Record<string, string>,
) => Promise<Response> | Response;

interface PoolState {
  apiTokens: Array<Record<string, unknown>>;
  sessionTokens: Array<Record<string, unknown>>;
  handoffs: Map<string, Record<string, unknown>>;
}

interface LockState {
  owners: Map<
    string,
    { txId: string; release: () => void; wait: Promise<void> }
  >;
}

describe("User token refresh concurrency, failures, and sign-out race (FR-014, FR-226, FR-227, FR-022)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: BASE_NOW_MS, toFake: ["Date"] });
    configureEnv();
  });

  afterEach(() => {
    vi.useRealTimers();
    setPool(null as never);
    globalThis.fetch = ORIGINAL_FETCH;
    process.env = { ...ORIGINAL_ENV };
  });

  it("leaves one valid token pair and calls GitHub once when two refreshes of the same session run at once", async () => {
    const refreshStarted = deferred();
    const releaseRefresh = deferred();
    let refreshCount = 0;
    const harness = createHarness(async () => {
      refreshCount += 1;

      if (refreshCount > 1) {
        return jsonResponse({ error: "bad_refresh_token" }, 400);
      }
      refreshStarted.resolve();
      await releaseRefresh.promise;

      return tokenPairResponse("ghu_rotated_1", "ghr_rotated_1");
    });

    const { sessionId } = await signIn(harness.server, harness.state);
    const first = freshAccessToken(harness.pool, sessionId);

    await refreshStarted.promise;
    const second = freshAccessToken(harness.pool, sessionId);

    releaseRefresh.resolve();
    const tokens = await Promise.all([first, second]);

    expect({
      tokens,
      refreshCalls: harness.refreshTokensSent.length,
      storedPair: decryptTokenPair(
        String(harness.state.sessionTokens[0]?.encrypted_tokens ?? ""),
        ENCRYPTION_KEY,
      ),
    }).toEqual({
      tokens: ["ghu_rotated_1", "ghu_rotated_1"],
      refreshCalls: 1,
      storedPair: {
        accessToken: "ghu_rotated_1",
        expiresIn: 28800,
        refreshToken: "ghr_rotated_1",
        refreshTokenExpiresIn: 15897600,
      },
    });
  });

  it("ends the session, deletes its stored tokens, and refuses subsequent requests with 401 when GitHub answers a refresh that the refresh token is invalid", async () => {
    const endedAnnouncements: string[] = [];
    const unsubscribe = onSessionEnded((id) => {
      endedAnnouncements.push(id);
    });
    const harness = createHarness(() =>
      jsonResponse({
        error: "bad_refresh_token",
        error_description: "The refresh token passed is incorrect or expired.",
      }),
    );

    try {
      const { sessionId, sessionToken } = await signIn(
        harness.server,
        harness.state,
      );
      const refreshStatus = await statusOf(
        freshAccessToken(harness.pool, sessionId),
      );
      const meResponse = await harness.server.inject({
        method: "GET",
        url: "/api/auth/me",
        headers: { authorization: `Bearer ${sessionToken}` },
      });

      expect({
        refreshStatus,
        meStatusAfter: meResponse.statusCode,
        revoked: harness.state.apiTokens[0]?.revoked_at !== null,
        storedTokenRows: harness.state.sessionTokens.length,
        endedAnnouncements,
      }).toEqual({
        refreshStatus: 401,
        meStatusAfter: 401,
        revoked: true,
        storedTokenRows: 0,
        endedAnnouncements: [sessionId],
      });
    } finally {
      unsubscribe();
    }
  });

  it("announces the ended session after revoking its token and deleting its stored pair when GitHub refuses the refresh token", async () => {
    const snapshots: Array<{
      id: string;
      revoked: boolean;
      storedTokenRows: number;
    }> = [];
    const harness = createHarness(() =>
      jsonResponse({ error: "invalid_grant" }, 400),
    );
    const unsubscribe = onSessionEnded((id) => {
      snapshots.push({
        id,
        revoked: harness.state.apiTokens[0]?.revoked_at !== null,
        storedTokenRows: harness.state.sessionTokens.length,
      });
    });

    try {
      const { sessionId } = await signIn(harness.server, harness.state);
      const refreshStatus = await statusOf(
        freshAccessToken(harness.pool, sessionId),
      );

      expect({ refreshStatus, snapshots }).toEqual({
        refreshStatus: 401,
        snapshots: [{ id: sessionId, revoked: true, storedTokenRows: 0 }],
      });
    } finally {
      unsubscribe();
    }
  });

  it("refuses with 503 like FR-033 and keeps the session and stored token pair when the connection to GitHub for a refresh cannot be opened", async () => {
    let canConnect = false;
    const harness = createHarness(() => {
      if (!canConnect) {
        throw connectionRefusedError();
      }

      return tokenPairResponse("ghu_recovered_1", "ghr_recovered_1");
    });

    const { sessionId, sessionToken } = await signIn(
      harness.server,
      harness.state,
    );

    vi.setSystemTime(BASE_NOW_MS + 6 * 60_000);
    const staleReposResponse = await harness.server.inject({
      method: "GET",
      url: "/api/repos",
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    const refreshStatus = await statusOf(
      freshAccessToken(harness.pool, sessionId),
    );
    const revokedAfterFailure = harness.state.apiTokens[0]?.revoked_at !== null;
    const storedRowsAfterFailure = harness.state.sessionTokens.length;

    canConnect = true;
    const recoveredReposResponse = await harness.server.inject({
      method: "GET",
      url: "/api/repos",
      headers: { authorization: `Bearer ${sessionToken}` },
    });

    expect({
      refreshStatus,
      staleReposStatus: staleReposResponse.statusCode,
      revokedAfterFailure,
      storedRowsAfterFailure,
      recoveredReposStatus: recoveredReposResponse.statusCode,
    }).toEqual({
      refreshStatus: 503,
      staleReposStatus: 503,
      revokedAfterFailure: false,
      storedRowsAfterFailure: 1,
      recoveredReposStatus: 200,
    });
  });

  it("leaves no stored token for the session when POST /api/auth/logout arrives while a refresh of the same session is in flight", async () => {
    const refreshInFlight = deferred();
    const releaseRefresh = deferred();
    const harness = createHarness(async () => {
      refreshInFlight.resolve();
      await releaseRefresh.promise;

      return tokenPairResponse("ghu_after_logout", "ghr_after_logout");
    });

    const { sessionId, sessionToken } = await signIn(
      harness.server,
      harness.state,
    );
    const refreshOutcome = statusOf(freshAccessToken(harness.pool, sessionId));

    await refreshInFlight.promise;
    const logoutPromise = harness.server.inject({
      method: "POST",
      url: "/api/auth/logout",
      headers: { authorization: `Bearer ${sessionToken}` },
    });

    await flushMicrotasks();
    releaseRefresh.resolve();
    const [, logoutResponse] = await Promise.all([
      refreshOutcome,
      logoutPromise,
    ]);
    const meAfter = await harness.server.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { authorization: `Bearer ${sessionToken}` },
    });

    expect({
      logoutStatus: logoutResponse.statusCode,
      storedTokenRows: harness.state.sessionTokens.length,
      revoked: harness.state.apiTokens[0]?.revoked_at !== null,
      meStatusAfter: meAfter.statusCode,
    }).toEqual({
      logoutStatus: 200,
      storedTokenRows: 0,
      revoked: true,
      meStatusAfter: 401,
    });
  });

  it("refuses with 503 and keeps the session and stored token pair when GitHub answers a refresh with an error that is not about the refresh token", async () => {
    const harness = createHarness(() =>
      jsonResponse({
        error: "incorrect_client_credentials",
        error_description:
          "The client_id and/or client_secret passed are incorrect.",
      }),
    );
    const { sessionId } = await signIn(harness.server, harness.state);
    const refreshStatus = await statusOf(
      freshAccessToken(harness.pool, sessionId),
    );

    expect({
      refreshStatus,
      revoked: harness.state.apiTokens[0]?.revoked_at !== null,
      storedTokenRows: harness.state.sessionTokens.length,
    }).toEqual({ refreshStatus: 503, revoked: false, storedTokenRows: 1 });
  });

  it("refuses and keeps the session and stored token pair when the refresh request fails after the connection opened", async () => {
    const harness = createHarness(() => {
      const cause = Object.assign(new Error("socket hang up"), {
        code: "ECONNRESET",
      });

      throw Object.assign(new TypeError("fetch failed"), { cause });
    });
    const { sessionId } = await signIn(harness.server, harness.state);
    const refreshStatus = await statusOf(
      freshAccessToken(harness.pool, sessionId),
    );

    expect({
      refused: refreshStatus !== 200,
      revoked: harness.state.apiTokens[0]?.revoked_at !== null,
      storedTokenRows: harness.state.sessionTokens.length,
    }).toEqual({ refused: true, revoked: false, storedTokenRows: 1 });
  });

  it("refuses POST /api/auth/logout with no credential or a made-up one with 401 and ends no session", async () => {
    const harness = createHarness(() =>
      tokenPairResponse("ghu_unused", "ghr_unused"),
    );

    await signIn(harness.server, harness.state);
    const anonymous = await harness.server.inject({
      method: "POST",
      url: "/api/auth/logout",
    });
    const madeUp = await harness.server.inject({
      method: "POST",
      url: "/api/auth/logout",
      headers: { authorization: "Bearer lore_made_up_session_token" },
    });

    expect({
      anonymousStatus: anonymous.statusCode,
      madeUpStatus: madeUp.statusCode,
      revoked: harness.state.apiTokens[0]?.revoked_at !== null,
      storedTokenRows: harness.state.sessionTokens.length,
    }).toEqual({
      anonymousStatus: 401,
      madeUpStatus: 401,
      revoked: false,
      storedTokenRows: 1,
    });
  });
});

function configureEnv(): void {
  process.env.LORE_API_URL = API_URL;
  process.env.LORE_UI_URL = UI_URL;
  process.env.GITHUB_APP_CLIENT_ID = "Iv1.testclient";
  process.env.GITHUB_APP_CLIENT_SECRET = "app-client-secret";
  process.env.GITHUB_APP_INSTALLATION_ID = INSTALLATION_ID;
  process.env.GITHUB_ORG = GITHUB_ORG;
  process.env.LORE_USER_TOKEN_ENCRYPTION_KEY = ENCRYPTION_KEY;
  process.env.GITHUB_TOKEN = "ghs_app_env_token";
}

function createHarness(onRefresh: RefreshHandler) {
  const state: PoolState = {
    apiTokens: [],
    sessionTokens: [],
    handoffs: new Map(),
  };
  const pool = createLockingPool(state);
  const refreshTokensSent: string[] = [];

  setPool(pool as never);
  const server = buildServer(() => pool as never);

  globalThis.fetch = createGithubFetch(onRefresh, refreshTokensSent);

  return { server, pool, state, refreshTokensSent };
}

function createGithubFetch(
  onRefresh: RefreshHandler,
  refreshTokensSent: string[],
): typeof fetch {
  return async (input, init) => {
    const url = typeof input === "string" ? input : input.toString();
    const bodyText = typeof init?.body === "string" ? init.body : "";

    if (url === "https://github.com/login/oauth/access_token") {
      return handleOAuthToken(bodyText, onRefresh, refreshTokensSent);
    }

    return handleGithubApiGet(url);
  };
}

function handleOAuthToken(
  bodyText: string,
  onRefresh: RefreshHandler,
  refreshTokensSent: string[],
): Promise<Response> | Response {
  const body = JSON.parse(bodyText || "{}") as Record<string, string>;

  if (body.grant_type === "refresh_token") {
    refreshTokensSent.push(body.refresh_token ?? "");

    return onRefresh(body);
  }

  return tokenPairResponse(INITIAL_ACCESS_TOKEN, INITIAL_REFRESH_TOKEN, 120);
}

function handleGithubApiGet(url: string): Response {
  if (url === "https://api.github.com/user") {
    return jsonResponse({
      id: 4242,
      login: "ada",
      name: "Ada",
      avatar_url: "https://a/1",
    });
  }

  if (
    url === `https://api.github.com/user/memberships/orgs/${GITHUB_ORG}` ||
    url === `https://api.github.com/orgs/${GITHUB_ORG}/memberships/ada`
  ) {
    return jsonResponse({ state: "active", role: "member" });
  }

  if (
    url ===
    `https://api.github.com/user/installations/${INSTALLATION_ID}/repositories?per_page=100`
  ) {
    return jsonResponse({
      repositories: [{ full_name: "acme/app", owner: { login: "acme" } }],
    });
  }

  return jsonResponse({ message: `unexpected ${url}` }, 404);
}

function tokenPairResponse(
  accessToken: string,
  refreshToken: string,
  expiresIn = 28800,
): Response {
  return jsonResponse({
    access_token: accessToken,
    token_type: "bearer",
    expires_in: expiresIn,
    refresh_token: refreshToken,
    refresh_token_expires_in: 15897600,
  });
}

function connectionRefusedError(): TypeError {
  const cause = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:443"), {
    code: "ECONNREFUSED",
  });

  return Object.assign(new TypeError("fetch failed"), { cause });
}

async function signIn(
  server: ReturnType<typeof buildServer>,
  state: PoolState,
) {
  const loginResponse = await server.inject({
    method: "GET",
    url: `/api/auth/login?return=${encodeURIComponent(`${UI_URL}/inbox`)}`,
  });
  const oauthState =
    new URL(String(loginResponse.headers.location)).searchParams.get("state") ??
    "";
  const callbackResponse = await server.inject({
    method: "GET",
    url: `/api/auth/callback?code=gh-code&state=${encodeURIComponent(oauthState)}`,
  });
  const code =
    new URL(String(callbackResponse.headers.location)).searchParams.get(
      "code",
    ) ?? "";
  const redeemResponse = await server.inject({
    method: "POST",
    url: "/api/auth/redeem",
    payload: { code },
  });
  const payload = redeemResponse.result as { token: string };
  const sessionId = String(state.apiTokens.at(-1)?.id ?? "");

  return { sessionId, sessionToken: payload.token };
}

function createLockingPool(committed: PoolState): Pool {
  const pool = makePool();
  const locks: LockState = { owners: new Map() };

  pool.connect.mockImplementation(async () => createTxClient(committed, locks));

  pool.query.mockImplementation(
    async (rawSql: string, params: unknown[] = []) =>
      executeSql(committed, String(rawSql).trim(), params, null),
  );

  return pool as unknown as Pool;
}

function createTxClient(committed: PoolState, locks: LockState) {
  const tx = {
    txId: randomUUID(),
    heldLocks: new Set<string>(),
    writes: [] as Array<(state: PoolState) => void>,
    active: false,
  };
  const ctx = { committed, locks };

  return {
    query: async (rawSql: string, params: unknown[] = []) =>
      runTxClientQuery(tx, ctx, String(rawSql).trim(), params),
    release: vi.fn(() => {
      if (!tx.active) {
        return;
      }
      tx.writes.length = 0;
      tx.active = false;
      releaseLocks(locks, tx.txId, tx.heldLocks);
    }),
  };
}

const TX_CONTROL = new Set(["BEGIN", "COMMIT", "ROLLBACK"]);

async function runTxClientQuery(
  tx: {
    txId: string;
    heldLocks: Set<string>;
    writes: Array<(state: PoolState) => void>;
    active: boolean;
  },
  ctx: { committed: PoolState; locks: LockState },
  sql: string,
  params: unknown[],
) {
  if (TX_CONTROL.has(sql)) {
    return applyTxControl(tx, ctx.committed, ctx.locks, sql);
  }
  const lockKey = lockKeyFor(sql, params, ctx.committed, tx.writes);

  if (lockKey && tx.active) {
    await acquireLock(ctx.locks, tx.txId, lockKey, tx.heldLocks);
  }

  return executeSql(
    buildTxView(ctx.committed, tx.writes),
    sql,
    params,
    tx.active ? tx.writes : null,
  );
}

function applyTxControl(
  tx: {
    txId: string;
    heldLocks: Set<string>;
    writes: Array<(state: PoolState) => void>;
    active: boolean;
  },
  committed: PoolState,
  locks: LockState,
  sql: string,
) {
  if (sql === "BEGIN") {
    tx.active = true;
    tx.writes.length = 0;

    return { rows: [] };
  }

  if (sql === "COMMIT") {
    for (const write of tx.writes) {
      write(committed);
    }
  }
  tx.writes.length = 0;
  tx.active = false;
  releaseLocks(locks, tx.txId, tx.heldLocks);

  return { rows: [] };
}

function lockKeyFor(
  sql: string,
  params: unknown[],
  committed: PoolState,
  writes: Array<(state: PoolState) => void>,
): string | null {
  if (isSessionLockSql(sql)) {
    return `session:${String(params[0])}`;
  }

  if (!isTokenLockSql(sql)) {
    return null;
  }
  const view = buildTxView(committed, writes);
  const found = view.apiTokens.find(
    (entry) => entry.token_hash === params[0] || entry.id === params[0],
  );

  return found ? `session:${String(found.id)}` : null;
}

function isSessionLockSql(sql: string): boolean {
  if (!sql.includes("pipeline.user_session_tokens")) {
    return false;
  }

  return (
    sql.includes("FOR UPDATE") ||
    sql.includes("UPDATE") ||
    sql.includes("DELETE")
  );
}

function isTokenLockSql(sql: string): boolean {
  if (!sql.includes("pipeline.api_tokens")) {
    return false;
  }

  return sql.includes("FOR UPDATE") || sql.includes("revoked_at = now()");
}

async function acquireLock(
  locks: LockState,
  txId: string,
  key: string,
  heldLocks: Set<string>,
): Promise<void> {
  while (true) {
    const current = locks.owners.get(key);

    if (!current || current.txId === txId) {
      break;
    }
    await current.wait;
  }

  if (heldLocks.has(key)) {
    return;
  }
  const gate = deferred();

  locks.owners.set(key, { txId, release: gate.resolve, wait: gate.promise });
  heldLocks.add(key);
}

function releaseLocks(
  locks: LockState,
  txId: string,
  heldLocks: Set<string>,
): void {
  for (const key of heldLocks) {
    const owner = locks.owners.get(key);

    if (owner?.txId === txId) {
      locks.owners.delete(key);
      owner.release();
    }
  }
  heldLocks.clear();
}

function buildTxView(
  committed: PoolState,
  writes: Array<(state: PoolState) => void>,
): PoolState {
  const view: PoolState = {
    apiTokens: committed.apiTokens.map((row) => ({ ...row })),
    sessionTokens: committed.sessionTokens.map((row) => ({ ...row })),
    handoffs: new Map(
      [...committed.handoffs.entries()].map(([key, row]) => [key, { ...row }]),
    ),
  };

  for (const write of writes) {
    write(view);
  }

  return view;
}

function executeSql(
  state: PoolState,
  sql: string,
  params: unknown[],
  writes: Array<(state: PoolState) => void> | null,
): { rows: Array<Record<string, unknown>> } {
  if (sql.includes("lore.login_handoffs")) {
    return executeHandoffSql(state, sql, params, writes);
  }

  if (sql.includes("pipeline.api_tokens")) {
    return executeApiTokensSql(state, sql, params, writes);
  }

  if (sql.includes("pipeline.user_session_tokens")) {
    return executeSessionTokensSql(state, sql, params, writes);
  }

  if (sql.includes("lore.repos")) {
    return {
      rows: sql.toLowerCase().includes("as total") ? [{ total: 0 }] : [],
    };
  }

  return { rows: [] };
}

function executeHandoffSql(
  state: PoolState,
  sql: string,
  params: unknown[],
  writes: Array<(state: PoolState) => void> | null,
): { rows: Array<Record<string, unknown>> } {
  if (sql.includes("INSERT INTO lore.login_handoffs")) {
    const columns = insertColumnsOf(sql, "lore.login_handoffs");
    const row = mapColumns(columns, params);

    applyMutation(state, writes, (target) => {
      target.handoffs.set(String(row.code_hash), row);
    });

    return { rows: [] };
  }

  if (!sql.includes("RETURNING")) {
    return { rows: [] };
  }
  const key = String(params[0]);
  const found = state.handoffs.get(key);

  if (!found || found.phase !== String(params[1])) {
    return { rows: [] };
  }

  applyMutation(state, writes, (target) => {
    target.handoffs.delete(key);
  });

  return {
    rows: [
      {
        returnUrl: found.return_url,
        grant: JSON.parse(String(found.grant_json)),
        encryptedTokens: found.encrypted_tokens,
        generation: found.generation ?? null,
        accessTokenExpiresAt: found.access_token_expires_at,
        refreshTokenExpiresAt: found.refresh_token_expires_at,
      },
    ],
  };
}

function executeApiTokensSql(
  state: PoolState,
  sql: string,
  params: unknown[],
  writes: Array<(state: PoolState) => void> | null,
): { rows: Array<Record<string, unknown>> } {
  if (sql.includes("INSERT INTO pipeline.api_tokens")) {
    return insertApiTokenRow(state, sql, params, writes);
  }

  if (sql.includes("UPDATE pipeline.api_tokens")) {
    return updateApiToken(state, sql, params, writes);
  }
  const found = state.apiTokens.find(
    (entry) => entry.token_hash === params[0] || entry.id === params[0],
  );

  return { rows: found ? [projectApiToken(state, found)] : [] };
}

function insertApiTokenRow(
  state: PoolState,
  sql: string,
  params: unknown[],
  writes: Array<(state: PoolState) => void> | null,
): { rows: Array<Record<string, unknown>> } {
  const columns = insertColumnsOf(sql, "pipeline.api_tokens");
  const id = randomUUID();
  const now = new Date(Date.now());
  const stored: Record<string, unknown> = {
    ...mapColumns(columns, params),
    id,
    created_at: now,
    repos_refreshed_at: now,
    revoked_at: null,
  };

  applyMutation(state, writes, (target) => {
    target.apiTokens.push(stored);
  });

  return {
    rows: [
      {
        id,
        name: stored.name,
        scopes: stored.scopes,
        created_at: now.toISOString(),
      },
    ],
  };
}

function updateApiToken(
  state: PoolState,
  sql: string,
  params: unknown[],
  writes: Array<(state: PoolState) => void> | null,
): { rows: Array<Record<string, unknown>> } {
  const byId = sql.includes("WHERE id = $1");
  const found = state.apiTokens.find((entry) =>
    byId ? entry.id === params[0] : entry.token_hash === params[0],
  );

  if (!found || found.revoked_at !== null) {
    return { rows: [] };
  }
  const now = new Date(Date.now());

  applyMutation(state, writes, (target) => {
    const row = target.apiTokens.find((entry) => entry.id === found.id);

    if (!row) {
      return;
    }
    applyApiTokenPatch(row, sql, now);
  });

  return {
    rows: sql.includes("RETURNING") ? [projectApiToken(state, found)] : [],
  };
}

function applyApiTokenPatch(
  row: Record<string, unknown>,
  sql: string,
  now: Date,
): void {
  if (sql.includes("last_used = now()")) {
    row.last_used = now;
  }

  if (sql.includes("repos_refreshed_at = now()")) {
    row.repos_refreshed_at = now;
  }

  if (sql.includes("revoked_at = now()")) {
    row.revoked_at = now;
  }
}

function projectApiToken(
  state: PoolState,
  row: Record<string, unknown>,
): Record<string, unknown> {
  const sessionRow = state.sessionTokens.find(
    (entry) => entry.token_id === row.id,
  );
  const refreshedAt = row.repos_refreshed_at ?? row.created_at;
  const encryptedTokens = sessionRow?.encrypted_tokens ?? null;

  return {
    id: row.id,
    scopes: row.scopes,
    kind: row.kind,
    github_id: row.github_id,
    login: row.login,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    repos: row.repos,
    startedAt: row.created_at,
    expiresAt: row.expires_at ?? null,
    revokedAt: row.revoked_at,
    generation: row.generation,
    reposRefreshedAt: refreshedAt,
    repos_refreshed_at: refreshedAt,
    encryptedTokens,
    encrypted_tokens: encryptedTokens,
  };
}

function executeSessionTokensSql(
  state: PoolState,
  sql: string,
  params: unknown[],
  writes: Array<(state: PoolState) => void> | null,
): { rows: Array<Record<string, unknown>> } {
  if (sql.includes("INSERT INTO pipeline.user_session_tokens")) {
    const columns = insertColumnsOf(sql, "pipeline.user_session_tokens");
    const row = mapColumns(columns, params);

    applyMutation(state, writes, (target) => {
      target.sessionTokens.push(row);
    });

    return { rows: [] };
  }

  if (sql.includes("UPDATE pipeline.user_session_tokens")) {
    applyMutation(state, writes, (target) => {
      const row = target.sessionTokens.find(
        (entry) => entry.token_id === params[0],
      );

      if (!row) {
        return;
      }
      row.encrypted_tokens = params[1];
      row.access_token_expires_at = params[2];
      row.refresh_token_expires_at = params[3];
    });

    return { rows: [] };
  }

  if (sql.includes("DELETE FROM pipeline.user_session_tokens")) {
    applyMutation(state, writes, (target) => {
      target.sessionTokens = target.sessionTokens.filter(
        (entry) => entry.token_id !== params[0],
      );
    });

    return { rows: [] };
  }
  const found = state.sessionTokens.find(
    (entry) => entry.token_id === params[0],
  );

  return {
    rows: found
      ? [
          {
            token_id: found.token_id,
            tokenId: found.token_id,
            encrypted_tokens: found.encrypted_tokens,
            encryptedTokens: found.encrypted_tokens,
            accessTokenExpiresAt: found.access_token_expires_at,
          },
        ]
      : [],
  };
}

function applyMutation(
  state: PoolState,
  writes: Array<(state: PoolState) => void> | null,
  mutate: (target: PoolState) => void,
): void {
  mutate(state);

  if (writes) {
    writes.push(mutate);
  }
}

function insertColumnsOf(sql: string, tableName: string): string[] {
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
  const record: Record<string, unknown> = {};

  columns.forEach((col, index) => {
    record[col] = params[index];
  });

  return record;
}

function statusOf(attempt: Promise<unknown>): Promise<number | string> {
  return attempt.then(
    () => 200,
    (err: { output?: { statusCode?: number }; message?: string }) =>
      err.output?.statusCode ?? `error:${err.message ?? String(err)}`,
  );
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function deferred() {
  let resolve = () => {};
  const promise = new Promise<void>((res) => {
    resolve = res;
  });

  return { promise, resolve };
}

function flushMicrotasks(): Promise<void> {
  return Promise.resolve().then(() => undefined);
}
