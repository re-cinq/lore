import { generateKeyPairSync, randomBytes, randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  LEGACY_TOKEN,
  makePool,
  useRateLimitSafeClock,
} from "@re-cinq/lore-server-core/test-helpers/http-mock.js";
import { setPool } from "@re-cinq/lore-server-core/platform/db.js";
import { buildServer } from "../../app/build-server.js";

const originalEnv = { ...process.env };
const originalFetch = globalThis.fetch;

const API_URL = "https://api.example.com";
const UI_URL = "https://ui.example.com";
const GITHUB_ORG = "acme";
const INSTALLATION_ID = "12345";
const ENCRYPTION_KEY = randomBytes(32).toString("base64");
const APP_TOKEN = "ghs_app_env_token";
const APP_INSTALLATION_TOKEN = "ghs_app_installation_token";
const USER_ACCESS_TOKEN = "ghu_ada_user_token";
const USER_REFRESH_TOKEN = "ghr_ada_refresh_token";
const REFRESHED_USER_TOKEN = "ghu_ada_refreshed_token";
const REFRESHED_REFRESH_TOKEN = "ghr_ada_refreshed_refresh";

const APP_PRIVATE_KEY = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
}).privateKey;

type RepoPermissionLevel = "admin" | "write" | "read" | "none";

interface RecordedPermissionCheck {
  path: string;
  token: string;
}

interface PoolState {
  repos: Array<Record<string, unknown>>;
  apiTokens: Array<Record<string, unknown>>;
  sessionTokens: Array<Record<string, unknown>>;
  handoffs: Map<string, Record<string, unknown>>;
}

interface HarnessConfig {
  installationRepos: string[];
  initialAccessExpiresIn?: number;
  refreshError?: string;
  permissionFor: (token: string) => {
    status: number;
    permission?: RepoPermissionLevel;
  };
}

describe("repository guard with the person's own Step 3 token (FR-009)", () => {
  useRateLimitSafeClock();

  beforeEach(() => {
    configureEnv();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    globalThis.fetch = originalFetch;
  });

  it("asks GitHub for the person's level with that person's own token, never the App's, and refuses with 403 below the route's declared level", async () => {
    let currentLevel: RepoPermissionLevel = "read";
    const harness = createHarness({
      installationRepos: ["acme/app"],
      permissionFor: (token) =>
        token === USER_ACCESS_TOKEN
          ? { status: 200, permission: currentLevel }
          : { status: 403 },
    });
    const sessionToken = await signIn(harness.server);
    const statuses: number[] = [];

    statuses.push(
      (await callWriteRoute(harness.server, sessionToken)).statusCode,
    );
    const chunkQueriesOnDeny = harness.sqlCalls.filter(({ sql }) =>
      sql.includes(".chunks"),
    );

    currentLevel = "write";
    statuses.push(
      (await callWriteRoute(harness.server, sessionToken)).statusCode,
    );
    statuses.push(
      (await callAdminRoute(harness.server, sessionToken)).statusCode,
    );

    currentLevel = "admin";
    statuses.push(
      (await callAdminRoute(harness.server, sessionToken)).statusCode,
    );

    expect({
      statuses,
      chunkQueriesOnDeny,
      appTokenMints: harness.appTokenMints,
      permissionTokens: harness.permissionChecks.map((check) => check.token),
    }).toEqual({
      statuses: [403, 200, 403, 200],
      chunkQueriesOnDeny: [],
      appTokenMints: [],
      permissionTokens: [
        USER_ACCESS_TOKEN,
        USER_ACCESS_TOKEN,
        USER_ACCESS_TOKEN,
        USER_ACCESS_TOKEN,
      ],
    });
  }, 15_000);

  it("refreshes a person's stored GitHub token when due before asking GitHub for their level, never falling back to the App", async () => {
    const harness = createHarness({
      installationRepos: ["acme/app"],
      initialAccessExpiresIn: 240,
      permissionFor: (token) =>
        token === REFRESHED_USER_TOKEN
          ? { status: 200, permission: "write" }
          : { status: 403 },
    });
    const sessionToken = await signIn(harness.server);

    const writeResponse = await callWriteRoute(harness.server, sessionToken);

    expect({
      status: writeResponse.statusCode,
      refreshTokensSent: harness.refreshRequests,
      appTokenMints: harness.appTokenMints,
      permissionTokens: harness.permissionChecks.map((check) => check.token),
    }).toEqual({
      status: 200,
      refreshTokensSent: [USER_REFRESH_TOKEN],
      appTokenMints: [],
      permissionTokens: [REFRESHED_USER_TOKEN],
    });
  }, 15_000);
  it("refuses the person and never asks as the App when GitHub refuses to refresh their due token", async () => {
    const harness = createHarness({
      installationRepos: ["acme/app"],
      initialAccessExpiresIn: 240,
      refreshError: "bad_refresh_token",
      permissionFor: () => ({ status: 200, permission: "admin" }),
    });
    const sessionToken = await signIn(harness.server);

    const writeResponse = await callWriteRoute(harness.server, sessionToken);

    expect({
      status: writeResponse.statusCode,
      chunkQueries: harness.sqlCalls.filter(({ sql }) =>
        sql.includes(".chunks"),
      ),
      appTokenMints: harness.appTokenMints,
      permissionChecks: harness.permissionChecks,
    }).toEqual({
      status: 500,
      chunkQueries: [],
      appTokenMints: [],
      permissionChecks: [],
    });
  }, 15_000);

  it("refuses the person and never asks as the App when their stored Step 3 token is gone", async () => {
    const harness = createHarness({
      installationRepos: ["acme/app"],
      permissionFor: () => ({ status: 200, permission: "admin" }),
    });
    const sessionToken = await signIn(harness.server);

    harness.state.sessionTokens.length = 0;
    const adminResponse = await callAdminRoute(harness.server, sessionToken);

    expect({
      status: adminResponse.statusCode,
      appTokenMints: harness.appTokenMints,
      permissionChecks: harness.permissionChecks,
    }).toEqual({
      status: 500,
      appTokenMints: [],
      permissionChecks: [],
    });
  }, 15_000);

  it.each([401, 500])(
    "refuses with 403 and never falls back to the App when GitHub answers the person's own token with %i",
    async (status) => {
      const harness = createHarness({
        installationRepos: ["acme/app"],
        permissionFor: (token) =>
          token === USER_ACCESS_TOKEN
            ? { status }
            : { status: 200, permission: "admin" },
      });
      const sessionToken = await signIn(harness.server);

      const writeResponse = await callWriteRoute(harness.server, sessionToken);

      expect({
        status: writeResponse.statusCode,
        chunkQueries: harness.sqlCalls.filter(({ sql }) =>
          sql.includes(".chunks"),
        ),
        appTokenMints: harness.appTokenMints,
        askedWithAppToken: harness.permissionChecks.some(
          (check) => check.token !== USER_ACCESS_TOKEN,
        ),
      }).toEqual({
        status: 403,
        chunkQueries: [],
        appTokenMints: [],
        askedWithAppToken: false,
      });
    },
    15_000,
  );
});

function configureEnv(): void {
  process.env.LORE_INGEST_TOKEN = LEGACY_TOKEN;
  process.env.LORE_API_URL = API_URL;
  process.env.LORE_UI_URL = UI_URL;
  process.env.GITHUB_APP_ID = "999";
  process.env.GITHUB_APP_PRIVATE_KEY = APP_PRIVATE_KEY;
  process.env.GITHUB_APP_CLIENT_ID = "Iv1.testclient";
  process.env.GITHUB_APP_CLIENT_SECRET = "app-client-secret";
  process.env.GITHUB_APP_INSTALLATION_ID = INSTALLATION_ID;
  process.env.GITHUB_ORG = GITHUB_ORG;
  process.env.LORE_USER_TOKEN_ENCRYPTION_KEY = ENCRYPTION_KEY;
  process.env.GITHUB_TOKEN = APP_TOKEN;
}

function callWriteRoute(
  server: ReturnType<typeof buildServer>,
  sessionToken: string,
) {
  return server.inject({
    method: "POST",
    url: "/api/repos/acme/app/chunks/prune",
    headers: { authorization: `Bearer ${sessionToken}` },
    payload: { present_paths: ["README.md"] },
  });
}

function callAdminRoute(
  server: ReturnType<typeof buildServer>,
  sessionToken: string,
) {
  return server.inject({
    method: "PUT",
    url: "/api/repos/acme/app/settings",
    headers: { authorization: `Bearer ${sessionToken}` },
    payload: { settings: { auto_merge: { enabled: true, min_age_hours: 0 } } },
  });
}

function createHarness(config: HarnessConfig) {
  const state: PoolState = {
    repos: [seededRepo("acme/app")],
    apiTokens: [],
    sessionTokens: [],
    handoffs: new Map(),
  };
  const sqlCalls: Array<{ sql: string; params: unknown[] }> = [];
  const appTokenMints: string[] = [];
  const refreshRequests: string[] = [];
  const permissionChecks: RecordedPermissionCheck[] = [];
  const pool = createFakePool(state, sqlCalls);

  setPool(pool as never);
  const server = buildServer(() => pool as never);

  globalThis.fetch = createFetchStub({
    config,
    appTokenMints,
    refreshRequests,
    permissionChecks,
  });

  return {
    server,
    state,
    sqlCalls,
    appTokenMints,
    refreshRequests,
    permissionChecks,
  };
}

function seededRepo(fullName: string): Record<string, unknown> {
  const [owner, name] = fullName.split("/");

  return {
    id: randomUUID(),
    owner,
    name,
    full_name: fullName,
    github_url: `https://github.com/${fullName}`,
    default_branch: "main",
    team: null,
    onboarded_at: new Date("2026-11-18T10:00:00Z"),
    onboarding_pr_url: null,
    onboarding_pr_merged: false,
    settings: { context_backend: "lore" },
  };
}

async function signIn(server: ReturnType<typeof buildServer>): Promise<string> {
  const loginRes = await server.inject({
    method: "GET",
    url: `/api/auth/login?return=${encodeURIComponent(`${UI_URL}/inbox`)}`,
  });
  const authorizeUrl = new URL(String(loginRes.headers.location));
  const state = authorizeUrl.searchParams.get("state") ?? "";
  const callbackRes = await server.inject({
    method: "GET",
    url: `/api/auth/callback?code=gh-code&state=${encodeURIComponent(state)}`,
  });
  const redirectUrl = new URL(String(callbackRes.headers.location));
  const code = redirectUrl.searchParams.get("code") ?? "";
  const redeemRes = await server.inject({
    method: "POST",
    url: "/api/auth/redeem",
    payload: { code },
  });

  return (redeemRes.result as { token: string }).token;
}

function createFetchStub(deps: {
  config: HarnessConfig;
  appTokenMints: string[];
  refreshRequests: string[];
  permissionChecks: RecordedPermissionCheck[];
}): typeof fetch {
  return async (input, init) => {
    const req = await readFetchRequest(input, init);
    const url = new URL(req.url);

    if (
      url.hostname === "github.com" &&
      url.pathname === "/login/oauth/access_token"
    ) {
      return handleOAuthToken(req.bodyText, deps);
    }

    if (url.hostname === "api.github.com") {
      return handleGithubApi(url, req, deps);
    }

    return new Response("not found", { status: 404 });
  };
}

function handleOAuthToken(
  bodyText: string,
  deps: {
    config: HarnessConfig;
    refreshRequests: string[];
  },
): Response {
  const body = JSON.parse(bodyText || "{}") as Record<string, string>;

  if (body.grant_type === "refresh_token") {
    deps.refreshRequests.push(body.refresh_token ?? "");

    return refreshReply(deps.config.refreshError);
  }

  return jsonResponse({
    access_token: USER_ACCESS_TOKEN,
    token_type: "bearer",
    expires_in: deps.config.initialAccessExpiresIn ?? 28_800,
    refresh_token: USER_REFRESH_TOKEN,
    refresh_token_expires_in: 15_811_200,
  });
}

function refreshReply(refreshError: string | undefined): Response {
  if (refreshError) {
    return jsonResponse({ error: refreshError });
  }

  return jsonResponse({
    access_token: REFRESHED_USER_TOKEN,
    token_type: "bearer",
    expires_in: 28_800,
    refresh_token: REFRESHED_REFRESH_TOKEN,
    refresh_token_expires_in: 15_811_200,
  });
}

function handleGithubApi(
  url: URL,
  req: { method: string; authorization: string },
  deps: {
    config: HarnessConfig;
    appTokenMints: string[];
    permissionChecks: RecordedPermissionCheck[];
  },
): Response {
  if (
    req.method === "POST" &&
    url.pathname === `/app/installations/${INSTALLATION_ID}/access_tokens`
  ) {
    deps.appTokenMints.push(url.pathname);

    return jsonResponse(
      {
        token: APP_INSTALLATION_TOKEN,
        expires_at: "2026-11-22T20:00:00Z",
      },
      201,
    );
  }

  const identityReply = handleIdentityGet(url, deps.config.installationRepos);

  if (identityReply) {
    return identityReply;
  }

  return handlePermissionLookup(url, req, deps);
}

function handleIdentityGet(
  url: URL,
  installationRepos: string[],
): Response | null {
  if (url.pathname === "/user") {
    return jsonResponse({
      id: 42,
      login: "ada",
      name: "Ada Lovelace",
      avatar_url: "https://avatars.example.com/ada",
    });
  }

  if (url.pathname === `/user/memberships/orgs/${GITHUB_ORG}`) {
    return jsonResponse({ state: "active", role: "member" });
  }

  if (url.pathname === `/user/installations/${INSTALLATION_ID}/repositories`) {
    return jsonResponse({
      total_count: installationRepos.length,
      repositories: installationRepos.map(toGithubRepoJson),
    });
  }

  return null;
}

function handlePermissionLookup(
  url: URL,
  req: { method: string; authorization: string },
  deps: {
    config: HarnessConfig;
    permissionChecks: RecordedPermissionCheck[];
  },
): Response {
  const token = tokenOf(req.authorization);

  if (url.pathname === "/repos/acme/app/collaborators/ada/permission") {
    return collaboratorPermissionReply(url.pathname, token, deps);
  }

  if (req.method === "GET" && url.pathname === "/repos/acme/app") {
    return repoPermissionReply(url.pathname, token, deps);
  }

  return jsonResponse({ message: "not found" }, 404);
}

function collaboratorPermissionReply(
  path: string,
  token: string,
  deps: {
    config: HarnessConfig;
    permissionChecks: RecordedPermissionCheck[];
  },
): Response {
  deps.permissionChecks.push({ path, token });
  const reply = deps.config.permissionFor(token);

  return reply.status === 200
    ? jsonResponse({ permission: reply.permission })
    : jsonResponse({ message: "Bad credentials" }, reply.status);
}

function repoPermissionReply(
  path: string,
  token: string,
  deps: {
    config: HarnessConfig;
    permissionChecks: RecordedPermissionCheck[];
  },
): Response {
  deps.permissionChecks.push({ path, token });
  const reply = deps.config.permissionFor(token);

  return reply.status === 200
    ? jsonResponse({
        full_name: "acme/app",
        default_branch: "main",
        permissions: permissionsFlagsFor(reply.permission ?? "none"),
      })
    : jsonResponse({ message: "Bad credentials" }, reply.status);
}

function permissionsFlagsFor(level: RepoPermissionLevel) {
  return {
    admin: level === "admin",
    maintain: false,
    push: level === "admin" || level === "write",
    triage: false,
    pull: level !== "none",
  };
}

function tokenOf(authorization: string): string {
  return authorization.replace(/^(token|Bearer)\s+/i, "");
}

function toGithubRepoJson(fullName: string) {
  const [owner, name] = fullName.split("/");

  return { full_name: fullName, name, owner: { login: owner } };
}

async function readFetchRequest(
  input: string | URL | Request,
  init: RequestInit | undefined,
): Promise<{
  url: string;
  method: string;
  authorization: string;
  bodyText: string;
}> {
  if (input instanceof Request) {
    return requestFromInstance(input, init);
  }

  return requestFromInit(input, init);
}

async function requestFromInstance(
  input: Request,
  init: RequestInit | undefined,
) {
  return {
    url: input.url,
    method: (init?.method ?? input.method).toUpperCase(),
    authorization:
      headerValue(init?.headers, "authorization") ||
      input.headers.get("authorization") ||
      "",
    bodyText: await input.clone().text(),
  };
}

function requestFromInit(input: string | URL, init: RequestInit | undefined) {
  return {
    url: input.toString(),
    method: (init?.method ?? "GET").toUpperCase(),
    authorization: headerValue(init?.headers, "authorization"),
    bodyText: typeof init?.body === "string" ? init.body : "",
  };
}

function headerValue(headers: HeadersInit | undefined, name: string): string {
  if (headers instanceof Headers) {
    return headers.get(name) ?? "";
  }
  const target = name.toLowerCase();

  return (
    headerEntries(headers).find(([key]) => key.toLowerCase() === target)?.[1] ??
    ""
  );
}

function headerEntries(
  headers: Exclude<HeadersInit, Headers> | undefined,
): Array<[string, string]> {
  if (!headers) {
    return [];
  }

  return Array.isArray(headers) ? headers : Object.entries(headers);
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function createFakePool(
  state: PoolState,
  sqlCalls: Array<{ sql: string; params: unknown[] }>,
) {
  const pool = makePool();
  const tx = { active: false, staged: clonePoolState(state) };

  pool.connect.mockImplementation(async () => ({
    query: async (rawSql: string, params: unknown[] = []) => {
      const sql = String(rawSql);

      sqlCalls.push({ sql, params });

      return runTxQuery(tx, state, sql, params);
    },
    release: vi.fn(),
  }));

  pool.query.mockImplementation(
    async (rawSql: string, params: unknown[] = []) => {
      const sql = String(rawSql);

      sqlCalls.push({ sql, params });

      return executePoolSql(state, sql, params);
    },
  );

  return pool;
}

function runTxQuery(
  tx: { active: boolean; staged: PoolState },
  committed: PoolState,
  rawSql: string,
  params: unknown[],
) {
  const trimmed = rawSql.trim();

  if (trimmed === "BEGIN") {
    tx.active = true;
    tx.staged = clonePoolState(committed);

    return { rows: [] };
  }

  if (trimmed === "COMMIT") {
    tx.active = false;
    copyPoolState(committed, tx.staged);

    return { rows: [] };
  }

  if (trimmed === "ROLLBACK") {
    tx.active = false;

    return { rows: [] };
  }

  return executePoolSql(tx.active ? tx.staged : committed, rawSql, params);
}

function clonePoolState(source: PoolState): PoolState {
  return {
    repos: source.repos.map((row) => ({ ...row })),
    apiTokens: source.apiTokens.map((row) => ({ ...row })),
    sessionTokens: source.sessionTokens.map((row) => ({ ...row })),
    handoffs: new Map(
      [...source.handoffs.entries()].map(([key, row]) => [key, { ...row }]),
    ),
  };
}

function copyPoolState(target: PoolState, source: PoolState): void {
  target.repos.splice(0, target.repos.length, ...source.repos);
  target.apiTokens.splice(0, target.apiTokens.length, ...source.apiTokens);
  target.sessionTokens.splice(
    0,
    target.sessionTokens.length,
    ...source.sessionTokens,
  );
  target.handoffs.clear();

  for (const [key, row] of source.handoffs.entries()) {
    target.handoffs.set(key, row);
  }
}

const POOL_SQL_HANDLERS: Array<{
  matches: (sql: string) => boolean;
  run: (
    state: PoolState,
    sql: string,
    params: unknown[],
  ) => { rows: Array<Record<string, unknown>> };
}> = [
  {
    matches: (sql) =>
      sql.trim() === "SELECT 1" || sql.includes("information_schema.schemata"),
    run: () => ({ rows: [{ ok: 1 }] }),
  },
  {
    matches: (sql) => sql.includes("FROM information_schema.tables"),
    run: () => ({ rows: [{ table_schema: "org_shared" }] }),
  },
  {
    matches: (sql) => sql.includes("lore.login_handoffs"),
    run: (state, sql, params) => handleHandoffSql(state.handoffs, sql, params),
  },
  {
    matches: (sql) =>
      sql.includes("pipeline.user_session_tokens") &&
      !sql.trimStart().startsWith("UPDATE pipeline.api_tokens"),
    run: (state, sql, params) => handleSessionTokensSql(state, sql, params),
  },
  {
    matches: (sql) => sql.includes("pipeline.api_tokens"),
    run: (state, sql, params) => handleApiTokensSql(state, sql, params),
  },
  {
    matches: (sql) => sql.includes("lore.repos"),
    run: (state, sql, params) => handleReposSql(state.repos, sql, params),
  },
];

function executePoolSql(
  state: PoolState,
  sql: string,
  params: unknown[],
): { rows: Array<Record<string, unknown>> } {
  const handler = POOL_SQL_HANDLERS.find((entry) => entry.matches(sql));

  return handler ? handler.run(state, sql, params) : { rows: [] };
}

function handleHandoffSql(
  handoffs: Map<string, Record<string, unknown>>,
  sql: string,
  params: unknown[],
): { rows: Array<Record<string, unknown>> } {
  if (!sql.includes("INSERT INTO lore.login_handoffs")) {
    return sql.includes("RETURNING")
      ? claimHandoff(handoffs, params)
      : { rows: [] };
  }
  const columns = insertColumnsOf(sql, "lore.login_handoffs");
  const row = mapColumns(columns, params);

  handoffs.set(String(row.code_hash), row);

  return { rows: [] };
}

function claimHandoff(
  handoffs: Map<string, Record<string, unknown>>,
  params: unknown[],
): { rows: Array<Record<string, unknown>> } {
  const row = handoffs.get(String(params[0]));

  if (!row || row.phase !== String(params[1])) {
    return { rows: [] };
  }
  handoffs.delete(String(params[0]));

  return {
    rows: [
      {
        returnUrl: row.return_url,
        grant: JSON.parse(String(row.grant_json)),
        encryptedTokens: row.encrypted_tokens,
        generation: row.generation ?? null,
        accessTokenExpiresAt: row.access_token_expires_at,
        refreshTokenExpiresAt: row.refresh_token_expires_at,
      },
    ],
  };
}

function handleApiTokensSql(
  state: PoolState,
  sql: string,
  params: unknown[],
): { rows: Array<Record<string, unknown>> } {
  if (sql.includes("INSERT INTO pipeline.api_tokens")) {
    return insertApiToken(state, sql, params);
  }

  if (sql.includes("UPDATE pipeline.api_tokens")) {
    return updateApiTokenRow(state, sql, params);
  }
  const row = state.apiTokens.find((entry) => entry.token_hash === params[0]);

  return { rows: row ? [projectTokenRow(state, row)] : [] };
}

const RECORDED_AT = new Date("2026-11-18T10:00:00Z");

function insertApiToken(
  state: PoolState,
  sql: string,
  params: unknown[],
): { rows: Array<Record<string, unknown>> } {
  const columns = insertColumnsOf(sql, "pipeline.api_tokens");
  const row = mapColumns(columns, params);
  const stored: Record<string, unknown> = {
    ...row,
    id: randomUUID(),
    created_at: RECORDED_AT,
    repos_refreshed_at: row.repos_refreshed_at ?? RECORDED_AT,
    revoked_at: null,
  };

  state.apiTokens.push(stored);

  return {
    rows: [
      {
        id: stored.id,
        name: stored.name,
        scopes: stored.scopes,
        created_at: RECORDED_AT.toISOString(),
      },
    ],
  };
}

function updateApiTokenRow(
  state: PoolState,
  sql: string,
  params: unknown[],
): { rows: Array<Record<string, unknown>> } {
  const row = sql.includes("WHERE id = $1")
    ? state.apiTokens.find((entry) => entry.id === params[0])
    : state.apiTokens.find((entry) => entry.token_hash === params[0]);

  if (!row || row.revoked_at !== null) {
    return { rows: [] };
  }
  applyTokenUpdates(row, sql);

  return {
    rows: sql.includes("RETURNING") ? [projectTokenRow(state, row)] : [],
  };
}

function applyTokenUpdates(row: Record<string, unknown>, sql: string): void {
  if (sql.includes("last_used = now()")) {
    row.last_used = RECORDED_AT;
  }

  if (sql.includes("repos_refreshed_at = now()")) {
    row.repos_refreshed_at = RECORDED_AT;
  }
}

function projectTokenRow(
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

function handleSessionTokensSql(
  state: PoolState,
  sql: string,
  params: unknown[],
): { rows: Array<Record<string, unknown>> } {
  if (sql.includes("INSERT INTO pipeline.user_session_tokens")) {
    const columns = insertColumnsOf(sql, "pipeline.user_session_tokens");

    state.sessionTokens.push(mapColumns(columns, params));

    return { rows: [] };
  }

  if (sql.includes("UPDATE pipeline.user_session_tokens")) {
    updateSessionTokenRow(state.sessionTokens, params);

    return { rows: [] };
  }
  const row = state.sessionTokens.find((entry) => entry.token_id === params[0]);

  return {
    rows: row
      ? [
          {
            token_id: row.token_id,
            tokenId: row.token_id,
            encrypted_tokens: row.encrypted_tokens,
            encryptedTokens: row.encrypted_tokens,
            accessTokenExpiresAt: row.access_token_expires_at,
          },
        ]
      : [],
  };
}

function updateSessionTokenRow(
  sessionTokens: Array<Record<string, unknown>>,
  params: unknown[],
): void {
  const row = sessionTokens.find((entry) => entry.token_id === params[0]);

  if (!row) {
    return;
  }
  row.encrypted_tokens = params[1];
  row.access_token_expires_at = params[2];
  row.refresh_token_expires_at = params[3];
}

function handleReposSql(
  repos: Array<Record<string, unknown>>,
  sql: string,
  params: unknown[],
): { rows: Array<Record<string, unknown>> } {
  if (sql.includes("SELECT team FROM lore.repos")) {
    return { rows: [{ team: null }] };
  }

  if (sql.includes("SELECT full_name, team FROM lore.repos")) {
    const found = repos.find((repo) => repo.full_name === params[0]);

    return {
      rows: found
        ? [{ full_name: found.full_name, team: found.team ?? null }]
        : [],
    };
  }

  return { rows: [] };
}

function insertColumnsOf(sql: string, tableName: string): string[] {
  const escaped = tableName.replace(".", "\\.");
  const match = new RegExp(
    `INSERT INTO\\s+${escaped}\\s*\\(([^)]+)\\)`,
    "i",
  ).exec(sql);

  return (match?.[1] ?? "").split(",").map((col) => col.trim());
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
