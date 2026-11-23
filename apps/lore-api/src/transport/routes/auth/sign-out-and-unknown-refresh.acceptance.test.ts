import { randomBytes, randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { makePool } from "@re-cinq/lore-server-core/test-helpers/http-mock.js";
import { setPool } from "@re-cinq/lore-server-core/platform/db.js";
import { buildServer } from "../../../app/build-server.js";
import { onSessionEnded } from "../../../work/auth/session-ended.js";
import { freshAccessToken } from "../../../work/auth/user-token-refresh.js";

const API_URL = "https://lore-api.example.com";
const UI_URL = "https://lore-ui.example.com";
const GITHUB_ORG = "acme";
const INSTALLATION_ID = "42";
const ADMIN_TOKEN = "test-admin-token";
const ENCRYPTION_KEY = randomBytes(32).toString("base64");
const BASE_NOW_MS = new Date("2026-11-23T10:00:00.000Z").getTime();
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

interface LockOwner {
  txId: string;
  release: () => void;
  wait: Promise<void>;
}

interface TxHandle {
  txId: string;
  heldLocks: Set<string>;
  writes: Array<(state: PoolState) => void>;
  active: boolean;
}

describe("Sign-out lock and unknown refresh outcomes (FR-338, FR-340, FR-341, FR-015, FR-016, FR-471, FR-472)", () => {
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

  it("waits on the session token lock during POST /api/auth/logout, deletes stored tokens and marks the session ended in one transaction, and refuses a waiting refresh without calling GitHub", async () => {
    const endedAnnouncements: string[] = [];
    const unsubscribe = onSessionEnded((id) => {
      endedAnnouncements.push(id);
    });
    const refreshStarted = deferred();
    const releaseRefresh = deferred();
    const harness = createHarness(async () => {
      refreshStarted.resolve();
      await releaseRefresh.promise;

      return tokenPairResponse("ghu_rotated_1", "ghr_rotated_1", 120);
    });

    try {
      const { sessionId, sessionToken } = await signIn(
        harness.server,
        harness.state,
      );
      const race = await runSignOutLockRace(
        harness,
        { sessionId, sessionToken },
        {
          refreshStarted: refreshStarted.promise,
          releaseRefresh: releaseRefresh.resolve,
        },
      );
      const meAfter = await harness.server.inject({
        method: "GET",
        url: "/api/auth/me",
        headers: { authorization: `Bearer ${sessionToken}` },
      });

      expect({
        ...race,
        revoked: harness.state.apiTokens[0]?.revoked_at !== null,
        storedTokenRows: harness.state.sessionTokens.length,
        endedAnnouncements,
        refreshCalls: harness.refreshTokensSent.length,
        meStatusAfter: meAfter.statusCode,
      }).toEqual({
        logoutSettledWhileRefreshLocked: false,
        logoutStatus: 200,
        revoked: true,
        storedTokenRows: 0,
        endedAnnouncements: [sessionId],
        waitingRefreshStatus: 401,
        refreshCalls: 1,
        meStatusAfter: 401,
      });
    } finally {
      unsubscribe();
    }
  });

  it("refuses with 401 and calls GitHub for nothing when refreshing a session marked ended", async () => {
    const harness = createHarness(() =>
      tokenPairResponse("ghu_should_not_mint", "ghr_should_not_mint"),
    );
    const { sessionId } = await signIn(harness.server, harness.state);

    await harness.server.inject({
      method: "POST",
      url: "/api/tokens",
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
      payload: { action: "revoke", token_id: sessionId },
    });

    const refreshStatus = await statusOf(
      freshAccessToken(harness.pool, sessionId),
    );

    expect({
      refreshStatus,
      refreshCalls: harness.refreshTokensSent.length,
    }).toEqual({
      refreshStatus: 401,
      refreshCalls: 0,
    });
  });

  it("refuses with 401 and hands out no stored access token when the session is marked ended and its access token is not yet due", async () => {
    const harness = createHarness(() =>
      tokenPairResponse("ghu_should_not_mint", "ghr_should_not_mint"),
    );
    const { sessionId } = await signIn(harness.server, harness.state);
    const stored = harness.state.sessionTokens.find(
      (row) => row.token_id === sessionId,
    );

    if (stored) {
      stored.access_token_expires_at = new Date(BASE_NOW_MS + 3_600_000);
    }
    await harness.server.inject({
      method: "POST",
      url: "/api/tokens",
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
      payload: { action: "revoke", token_id: sessionId },
    });

    const refreshStatus = await statusOf(
      freshAccessToken(harness.pool, sessionId),
    );

    expect({
      storedRowRemains: harness.state.sessionTokens.length,
      refreshStatus,
      refreshCalls: harness.refreshTokensSent.length,
    }).toEqual({
      storedRowRemains: 1,
      refreshStatus: 401,
      refreshCalls: 0,
    });
  });

  it("refuses with 401 a refresh that gets the session token lock after the session was marked ended while it waited, even though its row remains", async () => {
    const refreshStarted = deferred();
    const releaseRefresh = deferred();
    const harness = createHarness(async () => {
      refreshStarted.resolve();
      await releaseRefresh.promise;

      return tokenPairResponse("ghu_rotated_1", "ghr_rotated_1");
    });
    const { sessionId } = await signIn(harness.server, harness.state);
    const waitingRefreshStatus = await refreshEndedWhileWaitingForLock(
      harness,
      sessionId,
      {
        refreshStarted: refreshStarted.promise,
        releaseRefresh: releaseRefresh.resolve,
      },
    );

    expect({
      storedRowRemains: harness.state.sessionTokens.length,
      waitingRefreshStatus,
      refreshCalls: harness.refreshTokensSent.length,
    }).toEqual({
      storedRowRemains: 1,
      waitingRefreshStatus: 401,
      refreshCalls: 1,
    });
  });

  it.each(["timeout", "lost-connection", "5xx"])(
    "ends the session, deletes its stored tokens, announces the end, and refuses subsequent requests with 401 when a sent refresh gets %s",
    async (kind) => {
      const endedAnnouncements: string[] = [];
      const unsubscribe = onSessionEnded((id) => {
        endedAnnouncements.push(id);
      });
      const harness = createHarness(() => unknownOutcomeAnswer(kind));

      try {
        const { sessionId, sessionToken } = await signIn(
          harness.server,
          harness.state,
        );
        const refreshStatus = await statusOf(
          freshAccessToken(harness.pool, sessionId),
        );
        const meAfter = await harness.server.inject({
          method: "GET",
          url: "/api/auth/me",
          headers: { authorization: `Bearer ${sessionToken}` },
        });

        expect({
          refreshRefused: refreshStatus === 401 || refreshStatus === 503,
          revoked: harness.state.apiTokens[0]?.revoked_at !== null,
          storedTokenRows: harness.state.sessionTokens.length,
          endedAnnouncements,
          meStatusAfter: meAfter.statusCode,
        }).toEqual({
          refreshRefused: true,
          revoked: true,
          storedTokenRows: 0,
          endedAnnouncements: [sessionId],
          meStatusAfter: 401,
        });
      } finally {
        unsubscribe();
      }
    },
  );

  it.each([400, 401, 403, 429])(
    "ends the session, deletes its stored tokens, announces the end, and refuses subsequent requests with 401 when GitHub answers a refresh with 4xx %i other than refresh-token refusal",
    async (status) => {
      const endedAnnouncements: string[] = [];
      const unsubscribe = onSessionEnded((id) => {
        endedAnnouncements.push(id);
      });
      const harness = createHarness(() =>
        jsonResponse(nonRefusal4xxBody(status), status),
      );

      try {
        const { sessionId, sessionToken } = await signIn(
          harness.server,
          harness.state,
        );
        const refreshStatus = await statusOf(
          freshAccessToken(harness.pool, sessionId),
        );
        const meAfter = await harness.server.inject({
          method: "GET",
          url: "/api/auth/me",
          headers: { authorization: `Bearer ${sessionToken}` },
        });

        expect({
          refreshRefused: refreshStatus === 401 || refreshStatus === 503,
          revoked: harness.state.apiTokens[0]?.revoked_at !== null,
          storedTokenRows: harness.state.sessionTokens.length,
          endedAnnouncements,
          meStatusAfter: meAfter.statusCode,
        }).toEqual({
          refreshRefused: true,
          revoked: true,
          storedTokenRows: 0,
          endedAnnouncements: [sessionId],
          meStatusAfter: 401,
        });
      } finally {
        unsubscribe();
      }
    },
  );

  it.each([
    "error-json",
    "non-json",
    "missing-refresh-expiry",
    "missing-access-expiry",
    "missing-refresh-token",
    "missing-access-token",
  ])(
    "ends the session, deletes its stored tokens, announces the end, and refuses subsequent requests with 401 when GitHub answers a refresh with 2xx whose body is %s",
    async (shape) => {
      const endedAnnouncements: string[] = [];
      const unsubscribe = onSessionEnded((id) => {
        endedAnnouncements.push(id);
      });
      const harness = createHarness(() => malformedPairAnswer(shape));

      try {
        const { sessionId, sessionToken } = await signIn(
          harness.server,
          harness.state,
        );
        const refreshStatus = await statusOf(
          freshAccessToken(harness.pool, sessionId),
        );
        const meAfter = await harness.server.inject({
          method: "GET",
          url: "/api/auth/me",
          headers: { authorization: `Bearer ${sessionToken}` },
        });

        expect({
          refreshRefused: refreshStatus === 401 || refreshStatus === 503,
          revoked: harness.state.apiTokens[0]?.revoked_at !== null,
          storedTokenRows: harness.state.sessionTokens.length,
          endedAnnouncements,
          meStatusAfter: meAfter.statusCode,
        }).toEqual({
          refreshRefused: true,
          revoked: true,
          storedTokenRows: 0,
          endedAnnouncements: [sessionId],
          meStatusAfter: 401,
        });
      } finally {
        unsubscribe();
      }
    },
  );
});

async function refreshEndedWhileWaitingForLock(
  harness: ReturnType<typeof createHarness>,
  sessionId: string,
  gates: { refreshStarted: Promise<void>; releaseRefresh: () => void },
) {
  const { firstRefresh, waitingRefresh } = await queueRefreshBehindRefresh(
    harness,
    sessionId,
    gates.refreshStarted,
  );

  markSessionEnded(harness.state, sessionId);
  gates.releaseRefresh();
  await statusOf(firstRefresh);

  return waitingRefresh;
}

async function queueRefreshBehindRefresh(
  harness: ReturnType<typeof createHarness>,
  sessionId: string,
  refreshStarted: Promise<void>,
) {
  const firstRefresh = freshAccessToken(harness.pool, sessionId);

  await refreshStarted;
  const waiting = harness.nextLockWaiter();
  const waitingRefresh = statusOf(freshAccessToken(harness.pool, sessionId));

  await waiting;

  return { firstRefresh, waitingRefresh };
}

function markSessionEnded(state: PoolState, sessionId: string): void {
  const apiToken = state.apiTokens.find((row) => row.id === sessionId);

  if (apiToken) {
    apiToken.revoked_at = new Date(BASE_NOW_MS);
  }
}

async function runSignOutLockRace(
  harness: ReturnType<typeof createHarness>,
  session: { sessionId: string; sessionToken: string },
  gates: { refreshStarted: Promise<void>; releaseRefresh: () => void },
) {
  const firstRefresh = freshAccessToken(harness.pool, session.sessionId);

  await gates.refreshStarted;
  const { logoutAttempt, waitingRefresh } = await queueLogoutAndRefresh(
    harness,
    session,
  );

  gates.releaseRefresh();
  await firstRefresh;
  const logoutResponse = await logoutAttempt.promise;

  return {
    logoutSettledWhileRefreshLocked: logoutAttempt.settledWhileLocked,
    logoutStatus: logoutResponse.statusCode,
    waitingRefreshStatus: await waitingRefresh,
  };
}

async function queueLogoutAndRefresh(
  harness: ReturnType<typeof createHarness>,
  session: { sessionId: string; sessionToken: string },
) {
  const logoutAttempt = await startLockedLogout(harness, session.sessionToken);
  const refreshWaiting = harness.nextLockWaiter();
  const waitingRefresh = statusOf(
    freshAccessToken(harness.pool, session.sessionId),
  );

  await refreshWaiting;

  return { logoutAttempt, waitingRefresh };
}

async function startLockedLogout(
  harness: ReturnType<typeof createHarness>,
  sessionToken: string,
) {
  let settled = false;
  const waiting = harness.nextLockWaiter();
  const promise = harness.server
    .inject({
      method: "POST",
      url: "/api/auth/logout",
      headers: { authorization: `Bearer ${sessionToken}` },
    })
    .then((response) => {
      settled = true;

      return response;
    });

  await waiting;

  return { promise, settledWhileLocked: settled };
}

function unknownOutcomeAnswer(kind: string): Response {
  if (kind === "timeout") {
    throw new DOMException(
      "The operation was aborted due to timeout",
      "TimeoutError",
    );
  }

  if (kind === "lost-connection") {
    const cause = Object.assign(new Error("socket hang up"), {
      code: "ECONNRESET",
    });

    throw Object.assign(new TypeError("fetch failed"), { cause });
  }

  return new Response("Bad Gateway", { status: 502 });
}

function nonRefusal4xxBody(status: number): Record<string, unknown> {
  if (status === 400) {
    return { error: "incorrect_client_credentials" };
  }

  if (status === 401) {
    return { error: "unauthorized_client" };
  }

  return { message: status === 403 ? "Forbidden" : "Too Many Requests" };
}

function malformedPairAnswer(shape: string): Response {
  if (shape === "error-json") {
    return jsonResponse({ error: "incorrect_client_credentials" });
  }

  if (shape === "non-json") {
    return new Response("<html>Bad Gateway</html>", {
      status: 200,
      headers: { "content-type": "text/html" },
    });
  }

  if (shape === "missing-refresh-expiry") {
    return jsonResponse({
      access_token: "ghu_new",
      expires_in: 28800,
      refresh_token: "ghr_new",
    });
  }

  if (shape === "missing-access-expiry") {
    return jsonResponse({
      access_token: "ghu_new",
      refresh_token: "ghr_new",
      refresh_token_expires_in: 15897600,
    });
  }

  if (shape === "missing-refresh-token") {
    return jsonResponse({
      access_token: "ghu_new",
      expires_in: 28800,
      refresh_token_expires_in: 15897600,
    });
  }

  return jsonResponse({
    expires_in: 28800,
    refresh_token: "ghr_new",
    refresh_token_expires_in: 15897600,
  });
}

function configureEnv(): void {
  process.env.LORE_API_URL = API_URL;
  process.env.LORE_UI_URL = UI_URL;
  process.env.GITHUB_APP_CLIENT_ID = "Iv1.testclient";
  process.env.GITHUB_APP_CLIENT_SECRET = "app-client-secret";
  process.env.GITHUB_APP_INSTALLATION_ID = INSTALLATION_ID;
  process.env.GITHUB_ORG = GITHUB_ORG;
  process.env.LORE_USER_TOKEN_ENCRYPTION_KEY = ENCRYPTION_KEY;
  process.env.LORE_INGEST_TOKEN = ADMIN_TOKEN;
  process.env.GITHUB_TOKEN = "ghs_app_env_token";
}

function createHarness(onRefresh: RefreshHandler) {
  const state: PoolState = {
    apiTokens: [],
    sessionTokens: [],
    handoffs: new Map(),
  };
  const lockWaiters: Array<() => void> = [];
  const pool = createLockingPool(state, () => {
    const notify = lockWaiters.shift();

    if (notify) {
      notify();
    }
  });
  const refreshTokensSent: string[] = [];

  setPool(pool as never);
  const server = buildServer(() => pool as never);

  globalThis.fetch = createGithubFetch(onRefresh, refreshTokensSent);

  return {
    server,
    pool,
    state,
    refreshTokensSent,
    nextLockWaiter: () =>
      new Promise<void>((resolve) => {
        lockWaiters.push(resolve);
      }),
  };
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

function createLockingPool(committed: PoolState, onLockWait: () => void): Pool {
  const pool = makePool();
  const locks = new Map<string, LockOwner>();

  pool.connect.mockImplementation(async () =>
    createTxClient(committed, locks, onLockWait),
  );

  pool.query.mockImplementation(
    async (rawSql: string, params: unknown[] = []) =>
      executeSql(committed, String(rawSql).trim(), params, null),
  );

  return pool as unknown as Pool;
}

function createTxClient(
  committed: PoolState,
  locks: Map<string, LockOwner>,
  onLockWait: () => void,
) {
  const tx: TxHandle = {
    txId: randomUUID(),
    heldLocks: new Set<string>(),
    writes: [],
    active: false,
  };

  return {
    query: async (rawSql: string, params: unknown[] = []) =>
      runTxClientQuery(
        tx,
        { committed, locks, onLockWait },
        String(rawSql).trim(),
        params,
      ),
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
  tx: TxHandle,
  ctx: {
    committed: PoolState;
    locks: Map<string, LockOwner>;
    onLockWait: () => void;
  },
  sql: string,
  params: unknown[],
) {
  if (TX_CONTROL.has(sql)) {
    return applyTxControl(tx, ctx.committed, ctx.locks, sql);
  }
  const lockKey = lockKeyFor(sql, params, ctx.committed, tx.writes);

  if (lockKey && tx.active) {
    await acquireLock(ctx, tx, lockKey);
  }

  return executeSql(
    buildTxView(ctx.committed, tx.writes),
    sql,
    params,
    tx.active ? tx.writes : null,
  );
}

function applyTxControl(
  tx: TxHandle,
  committed: PoolState,
  locks: Map<string, LockOwner>,
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
  ctx: { locks: Map<string, LockOwner>; onLockWait: () => void },
  tx: { txId: string; heldLocks: Set<string> },
  key: string,
): Promise<void> {
  while (true) {
    const current = ctx.locks.get(key);

    if (!current || current.txId === tx.txId) {
      break;
    }
    ctx.onLockWait();
    await current.wait;
  }

  if (tx.heldLocks.has(key)) {
    return;
  }
  const gate = deferred();

  ctx.locks.set(key, {
    txId: tx.txId,
    release: gate.resolve,
    wait: gate.promise,
  });
  tx.heldLocks.add(key);
}

function releaseLocks(
  locks: Map<string, LockOwner>,
  txId: string,
  heldLocks: Set<string>,
): void {
  for (const key of heldLocks) {
    const owner = locks.get(key);

    if (owner?.txId === txId) {
      locks.delete(key);
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

  if (isSessionTokensPrimarySql(sql)) {
    return executeSessionTokensSql(state, sql, params, writes);
  }

  if (sql.includes("pipeline.api_tokens")) {
    return executeApiTokensSql(state, sql, params, writes);
  }

  if (sql.includes("lore.repos")) {
    return {
      rows: sql.toLowerCase().includes("as total") ? [{ total: 0 }] : [],
    };
  }

  return { rows: [] };
}

function isSessionTokensPrimarySql(sql: string): boolean {
  if (sql.startsWith("SELECT")) {
    return sql.includes("FROM pipeline.user_session_tokens");
  }

  return (
    sql.startsWith("INSERT INTO pipeline.user_session_tokens") ||
    sql.startsWith("UPDATE pipeline.user_session_tokens") ||
    sql.startsWith("DELETE FROM pipeline.user_session_tokens")
  );
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

  if (!found) {
    return { rows: [] };
  }

  if (sql.includes("revoked_at IS NULL") && found.revoked_at !== null) {
    return { rows: [] };
  }

  return { rows: [projectApiToken(state, found)] };
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
    revoked_at: row.revoked_at,
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
    return insertSessionTokenRow(state, sql, params, writes);
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

  return selectSessionTokenRow(state, sql, params);
}

function insertSessionTokenRow(
  state: PoolState,
  sql: string,
  params: unknown[],
  writes: Array<(state: PoolState) => void> | null,
): { rows: Array<Record<string, unknown>> } {
  const columns = insertColumnsOf(sql, "pipeline.user_session_tokens");
  const row = mapColumns(columns, params);

  applyMutation(state, writes, (target) => {
    target.sessionTokens.push(row);
  });

  return { rows: [] };
}

function selectSessionTokenRow(
  state: PoolState,
  sql: string,
  params: unknown[],
): { rows: Array<Record<string, unknown>> } {
  const found = state.sessionTokens.find(
    (entry) => entry.token_id === params[0],
  );

  if (!found) {
    return { rows: [] };
  }
  const apiRow = state.apiTokens.find((entry) => entry.id === found.token_id);
  const revokedAt = apiRow ? apiRow.revoked_at : null;

  if (sql.includes("revoked_at IS NULL") && revokedAt !== null) {
    return { rows: [] };
  }

  return {
    rows: [
      {
        token_id: found.token_id,
        tokenId: found.token_id,
        encrypted_tokens: found.encrypted_tokens,
        encryptedTokens: found.encrypted_tokens,
        accessTokenExpiresAt: found.access_token_expires_at,
        revokedAt,
        revoked_at: revokedAt,
      },
    ],
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
