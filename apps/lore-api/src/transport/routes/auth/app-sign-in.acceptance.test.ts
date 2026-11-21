import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { authRoutes } from "./auth-routes.js";
import { serve } from "./auth-test-server.js";

const originalEnv = { ...process.env };
const originalFetch = globalThis.fetch;
const RETURN_URL = "http://localhost:3000/auth/callback";
const FIXED_NOW = new Date("2026-11-20T10:00:00.000Z");
const ENCRYPTION_KEY = "0123456789abcdef".repeat(4);
const ACCESS_TOKEN = "ghu_secret_access_tok";
const REFRESH_TOKEN = "ghr_secret_refresh_tok";
const HANDOFF_BASE_COLUMNS = new Set([
  "code_hash",
  "phase",
  "return_url",
  "grant_json",
  "expires_at",
]);

interface CapturedInsert {
  table: string;
  columns: string[];
  params: unknown[];
}

interface StoreSnapshot {
  handoffs: Map<string, Record<string, unknown>>;
  apiTokens: Array<Record<string, unknown>>;
  sessionTokens: CapturedInsert[];
}

interface GithubStubOptions {
  tokenReply?: { body: unknown; status: number };
  tokenError?: Error;
  tokenBody?: unknown;
  viewerBody?: unknown;
  orgReply?: { body: unknown; status: number };
}

interface PoolOptions {
  failApiTokenWrite?: Error;
  failSessionTokenWrite?: Error;
}

describe("GitHub App sign-in and stored user tokens (FR-010 to FR-430)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: FIXED_NOW, toFake: ["Date"] });
    configureAppSignInEnv();
  });

  afterEach(() => {
    vi.useRealTimers();
    process.env = { ...originalEnv };
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("sends a person starting login to the GitHub App authorization URL with the App client id and no OAuth scopes", async () => {
    const pool = createAuthPool();
    const res = await serve(authRoutes(() => pool.asPool())).inject(
      `/api/auth/login?return=${encodeURIComponent(RETURN_URL)}`,
    );
    const location = new URL(String(res.headers.location ?? ""));

    expect(res.statusCode).toBe(302);
    expect({
      originPath: location.origin + location.pathname,
      clientId: location.searchParams.get("client_id"),
      scope: location.searchParams.get("scope"),
    }).toEqual({
      originPath: "https://github.com/login/oauth/authorize",
      clientId: "Iv1.app-client-1",
      scope: null,
    });
  });

  it("exchanges the callback code with the GitHub App client id and client secret instead of the OAuth App credentials", async () => {
    const pool = createAuthPool();
    const server = serve(authRoutes(() => pool.asPool()));
    const exchangeRequests = installGithubFetchStub();
    const state = await startLogin(server);
    const callbackRes = await server.inject(
      `/api/auth/callback?code=gh-code&state=${state}`,
    );

    expect(callbackRes.statusCode).toBe(302);
    expect(
      new URL(String(callbackRes.headers.location ?? "")).searchParams.get(
        "auth_error",
      ),
    ).toBeNull();
    expect(exchangeRequests[0]).toMatchObject({
      client_id: "Iv1.app-client-1",
      client_secret: "app-secret-1",
      code: "gh-code",
    });
  });

  it("stores the encrypted GitHub token pair in its own column on lore.login_handoffs and keeps every token out of grant_json", async () => {
    const pool = createAuthPool();

    installGithubFetchStub();
    const server = serve(authRoutes(() => pool.asPool()));
    const state = await startLogin(server);

    await server.inject(`/api/auth/callback?code=gh-code&state=${state}`);

    const redeemRow = pool.findHandoffByPhase("redeem");
    const extraValues = extraHandoffValues(redeemRow);
    const grantText = serializedValue(redeemRow?.grant_json);
    const hasEncryptedColumn = extraValues.some(isNonEmptyEncryptedValue);

    expect({
      hasGrant: grantText.includes("gedaiu"),
      hasAccessInGrant: grantText.includes(ACCESS_TOKEN),
      hasRefreshInGrant: grantText.includes(REFRESH_TOKEN),
    }).toEqual({
      hasGrant: true,
      hasAccessInGrant: false,
      hasRefreshInGrant: false,
    });
    expect({
      hasEncryptedColumn,
      leaksToken: containsPlaintextToken(extraValues),
    }).toEqual({
      hasEncryptedColumn: true,
      leaksToken: false,
    });
  });

  it("deletes the handoff row, creates the pipeline.api_tokens session, and stores the encrypted session token row in one transaction on redeem", async () => {
    const pool = createAuthPool();

    installGithubFetchStub();
    const server = serve(authRoutes(() => pool.asPool()));
    const redeemCode = await completeCallback(server);
    const redeemRes = await server.inject({
      method: "POST",
      url: "/api/auth/redeem",
      payload: { code: redeemCode },
    });
    const body = JSON.parse(redeemRes.payload);

    expect(redeemRes.statusCode).toBe(200);
    expect(body.token).toMatch(/^lore_[0-9a-f]{64}$/);
    expect(pool.transactionSummary()).toEqual({
      committed: true,
      deletedHandoffInTx: true,
      createdSessionInTx: true,
      storedTokenRowInTx: true,
      remainingRedeemHandoffs: 0,
      apiTokenCount: 1,
      sessionTokenCount: 1,
      leaksPlaintextToken: false,
    });
  });

  it("rolls back the handoff deletion and session creation when storing the session token row fails", async () => {
    const pool = createAuthPool({
      failSessionTokenWrite: new Error("token write failed"),
    });

    installGithubFetchStub();
    const server = serve(authRoutes(() => pool.asPool()));
    const redeemCode = await completeCallback(server);
    const redeemRes = await server.inject({
      method: "POST",
      url: "/api/auth/redeem",
      payload: { code: redeemCode },
    });

    expect(redeemRes.statusCode).toBe(500);
    expect(pool.rollbackSummary()).toEqual({
      rolledBack: true,
      committed: false,
      remainingRedeemHandoffs: 1,
      apiTokenCount: 0,
      sessionTokenCount: 0,
    });
  });

  it("refuses callback when GitHub answers a non-string token or a viewer with no login and writes no redeem row", async () => {
    const pool = createAuthPool();
    const server = serve(authRoutes(() => pool.asPool()));

    installGithubFetchStub({ tokenBody: { access_token: 12345 } });
    const firstState = await startLogin(server);
    const malformedTokenRes = await server.inject(
      `/api/auth/callback?code=gh-code&state=${firstState}`,
    );

    installGithubFetchStub({ viewerBody: { message: "bad gateway" } });
    const secondState = await startLogin(server);
    const malformedViewerRes = await server.inject(
      `/api/auth/callback?code=gh-code&state=${secondState}`,
    );

    expect({
      tokenRedirect: callbackRedirectSummary(malformedTokenRes),
      viewerRedirect: callbackRedirectSummary(malformedViewerRes),
      remainingRedeemHandoffs: pool.rollbackSummary().remainingRedeemHandoffs,
    }).toEqual({
      tokenRedirect: { authError: "github_denied", code: null },
      viewerRedirect: { authError: "github_denied", code: null },
      remainingRedeemHandoffs: 0,
    });
  });

  it("refuses callback for a missing or made-up state and for a caller outside the org without storing a redeem row", async () => {
    const pool = createAuthPool();
    const server = serve(authRoutes(() => pool.asPool()));
    const exchangeRequests = installGithubFetchStub({
      orgReply: { body: { message: "Not Found" }, status: 404 },
    });
    const noStateRes = await server.inject("/api/auth/callback?code=gh-code");
    const fakeStateRes = await server.inject(
      "/api/auth/callback?code=gh-code&state=made-up-state",
    );
    const exchangesBeforeValidState = exchangeRequests.length;
    const validState = await startLogin(server);
    const outsiderRes = await server.inject(
      `/api/auth/callback?code=gh-code&state=${validState}`,
    );

    expect({
      noStateStatus: noStateRes.statusCode,
      fakeStateStatus: fakeStateRes.statusCode,
      exchangesBeforeValidState,
    }).toEqual({
      noStateStatus: 400,
      fakeStateStatus: 400,
      exchangesBeforeValidState: 0,
    });
    expect({
      outsiderRedirect: callbackRedirectSummary(outsiderRes),
      redeemHandoff: pool.findHandoffByPhase("redeem"),
    }).toEqual({
      outsiderRedirect: { authError: "not_in_org", code: null },
      redeemHandoff: undefined,
    });
  });

  it("refuses redeem with a missing, wrong-type, or made-up code and writes no session or token row", async () => {
    const pool = createAuthPool();
    const server = serve(authRoutes(() => pool.asPool()));
    const emptyBodyRes = await server.inject({
      method: "POST",
      url: "/api/auth/redeem",
      payload: {},
    });
    const wrongTypeRes = await server.inject({
      method: "POST",
      url: "/api/auth/redeem",
      payload: { code: 12345 },
    });
    const fakeCodeRes = await server.inject({
      method: "POST",
      url: "/api/auth/redeem",
      payload: { code: "made-up-redeem-code" },
    });

    expect({
      emptyBodyStatus: emptyBodyRes.statusCode,
      wrongTypeStatus: wrongTypeRes.statusCode,
      fakeCodeStatus: fakeCodeRes.statusCode,
    }).toEqual({
      emptyBodyStatus: 400,
      wrongTypeStatus: 400,
      fakeCodeStatus: 401,
    });
    expect(pool.rollbackSummary()).toMatchObject({
      apiTokenCount: 0,
      sessionTokenCount: 0,
    });
  });

  it("refuses phase-confused handoff codes across callback and redeem without exchanging or writing rows", async () => {
    const pool = createAuthPool();
    const server = serve(authRoutes(() => pool.asPool()));
    const exchangeRequests = installGithubFetchStub();
    const stateCode = await startLogin(server);
    const stateAsRedeemRes = await server.inject({
      method: "POST",
      url: "/api/auth/redeem",
      payload: { code: stateCode },
    });
    const redeemCode = await completeCallback(server);
    const redeemAsStateRes = await server.inject(
      `/api/auth/callback?code=gh-code&state=${redeemCode}`,
    );

    expect({
      stateAsRedeemStatus: stateAsRedeemRes.statusCode,
      redeemAsStateStatus: redeemAsStateRes.statusCode,
      exchangeCount: exchangeRequests.length,
    }).toEqual({
      stateAsRedeemStatus: 401,
      redeemAsStateStatus: 400,
      exchangeCount: 1,
    });
    expect(pool.rollbackSummary()).toMatchObject({
      remainingRedeemHandoffs: 1,
      apiTokenCount: 0,
      sessionTokenCount: 0,
    });
  });

  it("refuses callback when GitHub errors, times out, or reports a pending org invite and writes no redeem row", async () => {
    const pool = createAuthPool();
    const server = serve(authRoutes(() => pool.asPool()));
    const token503Res = await callbackWithGithubStub(server, {
      tokenReply: { body: { message: "unavailable" }, status: 503 },
    });
    const org503Res = await callbackWithGithubStub(server, {
      orgReply: { body: { message: "unavailable" }, status: 503 },
    });
    const pendingOrgRes = await callbackWithGithubStub(server, {
      orgReply: { body: { state: "pending", role: "admin" }, status: 200 },
    });
    const timeoutRes = await callbackWithGithubStub(server, {
      tokenError: new DOMException("aborted due to timeout", "TimeoutError"),
    });

    expect({
      token503: callbackRedirectSummary(token503Res),
      org503: callbackRedirectSummary(org503Res),
      pendingOrg: callbackRedirectSummary(pendingOrgRes),
    }).toEqual({
      token503: { authError: "github_denied", code: null },
      org503: { authError: "not_in_org", code: null },
      pendingOrg: { authError: "not_in_org", code: null },
    });
    expect({
      timeoutStatus: timeoutRes.statusCode,
      timeoutLocation: timeoutRes.headers.location,
      remainingRedeemHandoffs: pool.rollbackSummary().remainingRedeemHandoffs,
    }).toEqual({
      timeoutStatus: 500,
      timeoutLocation: undefined,
      remainingRedeemHandoffs: 0,
    });
  });

  it("refuses login, callback, and redeem when the database or App settings are missing and rolls back when session creation fails", async () => {
    const unpooledStatuses = await statusesWithoutPool();
    const pool = createAuthPool();
    const unconfiguredStatuses = await statusesWithoutAppSettings(
      serve(authRoutes(() => pool.asPool())),
    );

    expect({
      unpooledStatuses,
      unconfiguredStatuses,
      handoffCount: pool.handoffCount(),
    }).toEqual({
      unpooledStatuses: { login: 503, callback: 503, redeem: 503 },
      unconfiguredStatuses: { withoutClientId: 503, withoutEncryptionKey: 503 },
      handoffCount: 0,
    });

    const sessionErrorPool = createAuthPool({
      failApiTokenWrite: new Error("api token write failed"),
    });
    const sessionErrorServer = serve(
      authRoutes(() => sessionErrorPool.asPool()),
    );

    installGithubFetchStub();
    const redeemCode = await completeCallback(sessionErrorServer);
    const redeemRes = await sessionErrorServer.inject({
      method: "POST",
      url: "/api/auth/redeem",
      payload: { code: redeemCode },
    });

    expect({
      redeemStatus: redeemRes.statusCode,
      rollback: sessionErrorPool.rollbackSummary(),
    }).toEqual({
      redeemStatus: 500,
      rollback: {
        rolledBack: true,
        committed: false,
        remainingRedeemHandoffs: 1,
        apiTokenCount: 0,
        sessionTokenCount: 0,
      },
    });
  });

  it("refuses disallowed or malformed inputs on login, callback, and redeem without writing rows", async () => {
    const pool = createAuthPool();
    const server = serve(authRoutes(() => pool.asPool()));
    const loginStatuses = await refusedLoginStatuses(server);
    const handoffsAfterRefusedLogins = pool.handoffCount();
    const exchangeRequests = installGithubFetchStub();
    const validState = await startLogin(server);
    const inputStatuses = await malformedCallbackAndRedeemStatuses(
      server,
      validState,
    );

    expect({ loginStatuses, handoffsAfterRefusedLogins }).toEqual({
      loginStatuses: {
        absentReturn: 400,
        blankReturn: 400,
        evilHost: 400,
        scriptScheme: 400,
      },
      handoffsAfterRefusedLogins: 0,
    });
    expect({
      inputStatuses,
      exchangeCount: exchangeRequests.length,
      handoffCount: pool.handoffCount(),
    }).toEqual({
      inputStatuses: {
        blankCodeCallback: 400,
        blankStateCallback: 400,
        arrayCodeCallback: 400,
        blankCodeRedeem: 400,
      },
      exchangeCount: 0,
      handoffCount: 1,
    });
    expect(pool.rollbackSummary()).toMatchObject({
      remainingRedeemHandoffs: 0,
      apiTokenCount: 0,
      sessionTokenCount: 0,
    });
  });
});

async function callbackWithGithubStub(
  server: ReturnType<typeof serve>,
  stubOptions: GithubStubOptions,
) {
  installGithubFetchStub(stubOptions);
  const state = await startLogin(server);

  return server.inject(`/api/auth/callback?code=gh-code&state=${state}`);
}

async function statusesWithoutPool() {
  const server = serve(authRoutes(() => null));
  const loginRes = await server.inject(
    `/api/auth/login?return=${encodeURIComponent(RETURN_URL)}`,
  );
  const callbackRes = await server.inject(
    "/api/auth/callback?code=gh-code&state=any-state",
  );
  const redeemRes = await server.inject({
    method: "POST",
    url: "/api/auth/redeem",
    payload: { code: "any-code" },
  });

  return {
    login: loginRes.statusCode,
    callback: callbackRes.statusCode,
    redeem: redeemRes.statusCode,
  };
}

async function statusesWithoutAppSettings(server: ReturnType<typeof serve>) {
  delete process.env.GITHUB_APP_CLIENT_ID;
  const withoutClientId = await server.inject(
    `/api/auth/login?return=${encodeURIComponent(RETURN_URL)}`,
  );

  configureAppSignInEnv();
  delete process.env.LORE_USER_TOKEN_ENCRYPTION_KEY;
  const withoutEncryptionKey = await server.inject(
    "/api/auth/callback?code=gh-code&state=any-state",
  );

  configureAppSignInEnv();

  return {
    withoutClientId: withoutClientId.statusCode,
    withoutEncryptionKey: withoutEncryptionKey.statusCode,
  };
}

async function refusedLoginStatuses(server: ReturnType<typeof serve>) {
  const absentReturn = await server.inject("/api/auth/login");
  const blankReturn = await server.inject("/api/auth/login?return=");
  const evilHost = await server.inject(
    `/api/auth/login?return=${encodeURIComponent("https://evil.example/auth/callback")}`,
  );
  const scriptScheme = await server.inject(
    `/api/auth/login?return=${encodeURIComponent("javascript:alert(1)")}`,
  );

  return {
    absentReturn: absentReturn.statusCode,
    blankReturn: blankReturn.statusCode,
    evilHost: evilHost.statusCode,
    scriptScheme: scriptScheme.statusCode,
  };
}

async function malformedCallbackAndRedeemStatuses(
  server: ReturnType<typeof serve>,
  validState: string,
) {
  const blankCodeCallback = await server.inject(
    `/api/auth/callback?code=&state=${validState}`,
  );
  const blankStateCallback = await server.inject(
    "/api/auth/callback?code=gh-code&state=",
  );
  const arrayCodeCallback = await server.inject(
    `/api/auth/callback?code=a&code=b&state=${validState}`,
  );
  const blankCodeRedeem = await server.inject({
    method: "POST",
    url: "/api/auth/redeem",
    payload: { code: "" },
  });

  return {
    blankCodeCallback: blankCodeCallback.statusCode,
    blankStateCallback: blankStateCallback.statusCode,
    arrayCodeCallback: arrayCodeCallback.statusCode,
    blankCodeRedeem: blankCodeRedeem.statusCode,
  };
}

function configureAppSignInEnv(): void {
  process.env.GITHUB_APP_ID = "99999";
  process.env.GITHUB_APP_CLIENT_ID = "Iv1.app-client-1";
  process.env.GITHUB_APP_CLIENT_SECRET = "app-secret-1";
  process.env.GITHUB_OAUTH_CLIENT_ID = "oauth-client-1";
  process.env.GITHUB_OAUTH_CLIENT_SECRET = "oauth-secret-1";
  process.env.LORE_API_URL = "https://lore-api.example";
  process.env.LORE_UI_URL = "https://lore.example";
  process.env.GITHUB_ORG = "re-cinq";
  process.env.USER_TOKEN_ENCRYPTION_KEY = ENCRYPTION_KEY;
  process.env.LORE_USER_TOKEN_ENCRYPTION_KEY = ENCRYPTION_KEY;
  process.env.TOKEN_ENCRYPTION_KEY = ENCRYPTION_KEY;
  process.env.LORE_TOKEN_ENCRYPTION_KEY = ENCRYPTION_KEY;
}

async function startLogin(server: ReturnType<typeof serve>): Promise<string> {
  const loginRes = await server.inject(
    `/api/auth/login?return=${encodeURIComponent(RETURN_URL)}`,
  );
  const location = new URL(String(loginRes.headers.location ?? ""));

  return String(location.searchParams.get("state") ?? "");
}

async function completeCallback(
  server: ReturnType<typeof serve>,
): Promise<string> {
  const state = await startLogin(server);
  const callbackRes = await server.inject(
    `/api/auth/callback?code=gh-code&state=${state}`,
  );
  const location = new URL(String(callbackRes.headers.location ?? ""));

  return String(location.searchParams.get("code") ?? "");
}

function callbackRedirectSummary(res: { headers: Record<string, unknown> }) {
  const location = new URL(String(res.headers.location ?? ""));

  return {
    authError: location.searchParams.get("auth_error"),
    code: location.searchParams.get("code"),
  };
}

function installGithubFetchStub(
  stubOptions: GithubStubOptions = {},
): Array<Record<string, unknown>> {
  const exchangeRequests: Array<Record<string, unknown>> = [];

  globalThis.fetch = vi.fn(async (input, init) => {
    const url = typeof input === "string" ? input : input.toString();

    return routeGithubFetch(url, init, exchangeRequests, stubOptions);
  }) as typeof fetch;

  return exchangeRequests;
}

async function routeGithubFetch(
  url: string,
  init: RequestInit | undefined,
  exchangeRequests: Array<Record<string, unknown>>,
  stubOptions: GithubStubOptions,
): Promise<Response> {
  if (url !== "https://github.com/login/oauth/access_token") {
    return githubGetReply(url, stubOptions);
  }

  const bodyText = typeof init?.body === "string" ? init.body : "{}";

  exchangeRequests.push(JSON.parse(bodyText) as Record<string, unknown>);

  return oauthTokenReply(stubOptions);
}

function oauthTokenReply(stubOptions: GithubStubOptions): Response {
  if (stubOptions.tokenError) {
    throw stubOptions.tokenError;
  }

  if (stubOptions.tokenReply) {
    return jsonReply(
      stubOptions.tokenReply.body,
      stubOptions.tokenReply.status,
    );
  }

  const defaultTokenBody = {
    access_token: ACCESS_TOKEN,
    expires_in: 28800,
    refresh_token: REFRESH_TOKEN,
    refresh_token_expires_in: 15897600,
    token_type: "bearer",
  };

  return jsonReply(stubOptions.tokenBody ?? defaultTokenBody);
}

function githubGetReply(url: string, stubOptions: GithubStubOptions): Response {
  if (
    url.startsWith("https://api.github.com/user/memberships/orgs/re-cinq") &&
    stubOptions.orgReply
  ) {
    return jsonReply(stubOptions.orgReply.body, stubOptions.orgReply.status);
  }

  const viewer = stubOptions.viewerBody ?? {
    id: 4242,
    login: "gedaiu",
    name: "Bogdan",
    avatar_url: "https://a/1",
  };
  const replies: Array<[string, unknown]> = [
    [
      "https://api.github.com/user/memberships/orgs/re-cinq",
      { state: "active", role: "member" },
    ],
    [
      "https://api.github.com/user/repos",
      [{ full_name: "re-cinq/lore", owner: { login: "re-cinq" } }],
    ],
    ["https://api.github.com/user", viewer],
  ];
  const matched = replies.find(([prefix]) => url.startsWith(prefix));

  return matched
    ? jsonReply(matched[1])
    : jsonReply({ message: "unexpected url" }, 404);
}

function jsonReply(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function extraHandoffValues(
  row: Record<string, unknown> | undefined,
): unknown[] {
  if (!row) {
    return [];
  }

  return Object.entries(row)
    .filter(([column]) => !HANDOFF_BASE_COLUMNS.has(column))
    .map(([, value]) => value);
}

function isNonEmptyEncryptedValue(value: unknown): boolean {
  if (typeof value === "string") {
    return value.length > 0;
  }

  return Buffer.isBuffer(value) && value.length > 0;
}

function containsPlaintextToken(values: unknown[]): boolean {
  return values.some((value) => {
    const text = serializedValue(value);

    return text.includes(ACCESS_TOKEN) || text.includes(REFRESH_TOKEN);
  });
}

function serializedValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (Buffer.isBuffer(value)) {
    return value.toString("utf-8");
  }

  return value === undefined ? "" : JSON.stringify(value);
}

function createAuthPool(options: PoolOptions = {}) {
  const committed: StoreSnapshot = {
    handoffs: new Map(),
    apiTokens: [],
    sessionTokens: [],
  };
  const txLogs: Array<string[]> = [];
  const counts = { committed: 0, rolledBack: 0 };

  const pool = {
    query: (sql: string, params: unknown[] = []) =>
      executeSql(committed, sql, params, options),
    connect: async () => createTxClient(committed, txLogs, counts, options),
  };

  return {
    asPool: () => pool as unknown as Pool,
    handoffCount: () => committed.handoffs.size,
    findHandoffByPhase: (phase: string) =>
      [...committed.handoffs.values()].find((row) => row.phase === phase),
    transactionSummary: () =>
      buildTransactionSummary(committed, txLogs, counts),
    rollbackSummary: () => buildRollbackSummary(committed, counts),
  };
}

function createTxClient(
  committed: StoreSnapshot,
  txLogs: Array<string[]>,
  counts: { committed: number; rolledBack: number },
  options: PoolOptions,
) {
  const tx = {
    active: false,
    committed,
    staged: cloneSnapshot(committed),
    counts,
  };
  const log: string[] = [];

  txLogs.push(log);

  return {
    query: async (sql: string, params: unknown[] = []) => {
      const trimmed = sql.trim();

      log.push(trimmed);

      if (
        trimmed === "BEGIN" ||
        trimmed === "COMMIT" ||
        trimmed === "ROLLBACK"
      ) {
        applyTxControl(trimmed, tx);

        return { rows: [] };
      }

      return executeSql(
        tx.active ? tx.staged : committed,
        sql,
        params,
        options,
      );
    },
    release: vi.fn(),
  };
}

function applyTxControl(
  command: string,
  tx: {
    active: boolean;
    committed: StoreSnapshot;
    staged: StoreSnapshot;
    counts: { committed: number; rolledBack: number };
  },
): void {
  if (command === "BEGIN") {
    tx.active = true;

    return;
  }

  tx.active = false;

  if (command === "COMMIT") {
    applySnapshot(tx.committed, tx.staged);
    tx.counts.committed += 1;

    return;
  }

  tx.counts.rolledBack += 1;
}

function buildTransactionSummary(
  committed: StoreSnapshot,
  txLogs: Array<string[]>,
  counts: { committed: number; rolledBack: number },
) {
  const statements = txLogs[0] ?? [];
  const tokenParams = committed.sessionTokens.flatMap((row) => row.params);

  return {
    committed: counts.committed > 0,
    deletedHandoffInTx: statements.some(
      (sql) =>
        sql.includes("DELETE FROM lore.login_handoffs") &&
        sql.includes("RETURNING"),
    ),
    createdSessionInTx: statements.some((sql) =>
      sql.includes("INSERT INTO pipeline.api_tokens"),
    ),
    storedTokenRowInTx: committed.sessionTokens.length === 1,
    remainingRedeemHandoffs: countRedeemHandoffs(committed),
    apiTokenCount: committed.apiTokens.length,
    sessionTokenCount: committed.sessionTokens.length,
    leaksPlaintextToken: containsPlaintextToken(tokenParams),
  };
}

function buildRollbackSummary(
  committed: StoreSnapshot,
  counts: { committed: number; rolledBack: number },
) {
  return {
    rolledBack: counts.rolledBack > 0,
    committed: counts.committed > 0,
    remainingRedeemHandoffs: countRedeemHandoffs(committed),
    apiTokenCount: committed.apiTokens.length,
    sessionTokenCount: committed.sessionTokens.length,
  };
}

function countRedeemHandoffs(snapshot: StoreSnapshot): number {
  return [...snapshot.handoffs.values()].filter((row) => row.phase === "redeem")
    .length;
}

function cloneSnapshot(snapshot: StoreSnapshot): StoreSnapshot {
  const handoffs = new Map<string, Record<string, unknown>>();

  for (const [key, row] of snapshot.handoffs.entries()) {
    handoffs.set(key, { ...row });
  }

  return {
    handoffs,
    apiTokens: snapshot.apiTokens.map((row) => ({ ...row })),
    sessionTokens: snapshot.sessionTokens.map((row) => ({ ...row })),
  };
}

function applySnapshot(target: StoreSnapshot, source: StoreSnapshot): void {
  target.handoffs = source.handoffs;
  target.apiTokens = source.apiTokens;
  target.sessionTokens = source.sessionTokens;
}

async function executeSql(
  target: StoreSnapshot,
  sql: string,
  params: unknown[],
  options: PoolOptions,
): Promise<{ rows: Array<Record<string, unknown>> }> {
  if (sql.includes("FROM lore.settings")) {
    return { rows: [] };
  }

  if (sql.includes("lore.login_handoffs")) {
    return executeHandoffSql(target.handoffs, sql, params);
  }

  if (sql.includes("INSERT INTO pipeline.api_tokens")) {
    return insertApiTokenRow(target.apiTokens, sql, params, options);
  }

  if (sql.includes("INSERT INTO")) {
    return insertSessionTokenRow(target.sessionTokens, sql, params, options);
  }

  return { rows: [] };
}

function executeHandoffSql(
  handoffs: Map<string, Record<string, unknown>>,
  sql: string,
  params: unknown[],
): { rows: Array<Record<string, unknown>> } {
  if (sql.includes("INSERT INTO lore.login_handoffs")) {
    insertHandoffRow(handoffs, sql, params);

    return { rows: [] };
  }

  if (sql.includes("RETURNING")) {
    return takeHandoffRow(handoffs, sql, params);
  }

  sweepExpiredHandoffs(handoffs);

  return { rows: [] };
}

function sweepExpiredHandoffs(
  handoffs: Map<string, Record<string, unknown>>,
): void {
  for (const [key, row] of handoffs.entries()) {
    const expiresAt = row.expires_at as Date;

    if (expiresAt.getTime() < FIXED_NOW.getTime()) {
      handoffs.delete(key);
    }
  }
}

function insertHandoffRow(
  handoffs: Map<string, Record<string, unknown>>,
  sql: string,
  params: unknown[],
): void {
  const columns = parseInsertColumns(sql, "lore.login_handoffs");
  const row = mapColumnsToParams(columns, params);

  handoffs.set(String(row.code_hash), row);
}

function takeHandoffRow(
  handoffs: Map<string, Record<string, unknown>>,
  sql: string,
  params: unknown[],
): { rows: Array<Record<string, unknown>> } {
  const codeHash = String(params[0]);
  const phase = String(params[1]);
  const row = handoffs.get(codeHash);

  if (!row || row.phase !== phase) {
    return { rows: [] };
  }

  const expiresAt = row.expires_at as Date;

  if (expiresAt.getTime() <= FIXED_NOW.getTime()) {
    return { rows: [] };
  }

  handoffs.delete(codeHash);

  return { rows: [projectReturning(sql, row)] };
}

function insertApiTokenRow(
  apiTokens: Array<Record<string, unknown>>,
  sql: string,
  params: unknown[],
  options: PoolOptions,
): { rows: Array<Record<string, unknown>> } {
  if (options.failApiTokenWrite) {
    throw options.failApiTokenWrite;
  }

  const columns = parseInsertColumns(sql, "pipeline.api_tokens");
  const row = mapColumnsToParams(columns, params);
  const stored: Record<string, unknown> = {
    ...row,
    id: "00000000-0000-0000-0000-000000000001",
    created_at: FIXED_NOW.toISOString(),
  };

  apiTokens.push(stored);

  return {
    rows: [
      {
        id: stored.id,
        name: stored.name,
        scopes: stored.scopes,
        created_at: stored.created_at,
      },
    ],
  };
}

function insertSessionTokenRow(
  sessionTokens: CapturedInsert[],
  sql: string,
  params: unknown[],
  options: PoolOptions,
): { rows: Array<Record<string, unknown>> } {
  if (options.failSessionTokenWrite) {
    throw options.failSessionTokenWrite;
  }

  const match = /INSERT INTO\s+([^\s(]+)\s*\(([^)]+)\)/i.exec(sql);
  const table = match?.[1] ?? "unknown";
  const columns = (match?.[2] ?? "").split(",").map((col) => col.trim());

  sessionTokens.push({ table, columns, params: [...params] });

  return { rows: [{ id: "00000000-0000-0000-0000-000000000002" }] };
}

function parseInsertColumns(sql: string, tableName: string): string[] {
  const escapedTable = tableName.replace(".", "\\.");
  const pattern = new RegExp(
    `INSERT INTO\\s+${escapedTable}\\s*\\(([^)]+)\\)`,
    "i",
  );
  const match = pattern.exec(sql);

  return (match?.[1] ?? "").split(",").map((col) => col.trim());
}

function mapColumnsToParams(
  columns: string[],
  params: unknown[],
): Record<string, unknown> {
  const row: Record<string, unknown> = {};

  columns.forEach((column, index) => {
    row[column] = params[index];
  });

  return row;
}

function projectReturning(
  sql: string,
  row: Record<string, unknown>,
): Record<string, unknown> {
  const clause = /RETURNING\s+([\s\S]+)$/i.exec(sql)?.[1] ?? "";
  const projected: Record<string, unknown> = {};

  for (const part of clause.split(",")) {
    assignReturningField(projected, row, part.trim());
  }

  return projected;
}

function assignReturningField(
  projected: Record<string, unknown>,
  row: Record<string, unknown>,
  part: string,
): void {
  const entry = parseReturningColumn(part);

  if (!entry) {
    return;
  }

  const raw = row[entry.column];

  projected[entry.alias] =
    entry.column === "grant_json" && typeof raw === "string"
      ? JSON.parse(raw)
      : raw;
}

function parseReturningColumn(
  part: string,
): { column: string; alias: string } | null {
  const aliased = /^(\w+)\s+AS\s+"?(\w+)"?$/i.exec(part);

  if (aliased) {
    return { column: aliased[1], alias: aliased[2] };
  }

  const plain = /^(\w+)$/.exec(part);

  return plain ? { column: plain[1], alias: plain[1] } : null;
}
