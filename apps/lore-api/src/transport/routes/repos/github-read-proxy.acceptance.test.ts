import { randomBytes, randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makePool } from "@re-cinq/lore-server-core/test-helpers/http-mock.js";
import { setPool } from "@re-cinq/lore-server-core/platform/db.js";
import { buildServer } from "../../../app/build-server.js";

const API_URL = "https://lore-api.example.com";
const UI_URL = "https://lore-ui.example.com";
const GITHUB_ORG = "acme";
const INSTALLATION_ID = "42";
const APP_TOKEN = "ghs_test_installation";
const USER_ACCESS_TOKEN = "ghu_person_read_proxy_access";
const USER_REFRESH_TOKEN = "ghr_person_read_proxy_refresh";
const ENCRYPTION_KEY = randomBytes(32).toString("base64");
const BASE_NOW_MS = new Date("2026-11-22T06:00:00.000Z").getTime();

const ORIGINAL_ENV = { ...process.env };
const ORIGINAL_FETCH = globalThis.fetch;

let nowMs = BASE_NOW_MS;

interface RecordedGithubRequest {
  method: string;
  path: string;
  authorization: string;
}

describe("Person-scoped GitHub read proxy routes (FR-216, FR-231, FR-233, FR-235)", () => {
  beforeEach(() => {
    nowMs += 600_000;
    vi.useFakeTimers({ now: nowMs, toFake: ["Date"] });
    configureEnv();
  });

  afterEach(() => {
    vi.useRealTimers();
    setPool(null as never);
    globalThis.fetch = ORIGINAL_FETCH;
    process.env = { ...ORIGINAL_ENV };
  });

  it("reads file, README, repository details, and pull request details on GitHub with the person's token, never the App's", async () => {
    const harness = createHarness({
      installationRepos: ["acme/app", "acme/unboarded"],
    });
    const token = await signIn(harness.server);

    harness.githubRequests.length = 0;

    const responses = await callAllReadProxyRoutes(harness.server, token, {
      fileRepo: "acme/app",
      readmeRepo: "acme/app",
      detailsRepo: "acme/unboarded",
      pullRepo: "acme/app",
    });

    const repoRequests = harness.githubRequests.filter((req) =>
      req.path.startsWith("/repos/acme/"),
    );

    expect({
      statuses: responses.map((res) => res.statusCode),
      file: responses[0].result,
      readme: responses[1].result,
      details: responses[2].result,
      pull: responses[3].result,
      allUsedPersonToken:
        repoRequests.length > 0 &&
        repoRequests.every((req) => isUserAuth(req.authorization)),
    }).toEqual({
      statuses: [200, 200, 200, 200],
      file: { content: "name: Lore Ingest\n" },
      readme: {
        markdown: "# App Readme\n",
        rawBaseUrl: "https://raw.githubusercontent.com/acme/app/main/",
        htmlUrl: "https://github.com/acme/app/blob/main/README.md",
      },
      details: {
        description: "Unboarded repository",
        default_branch: "main",
        html_url: "https://github.com/acme/unboarded",
      },
      pull: {
        number: 42,
        title: "Open PR",
        state: "open",
        draft: false,
        merged: false,
        mergeable: true,
        html_url: "https://github.com/acme/app/pull/42",
        checks: [{ name: "ci", status: "completed", conclusion: "success" }],
        reviews: [
          {
            user: "ada",
            state: "APPROVED",
            submitted_at: "2026-11-20T00:00:00Z",
          },
        ],
        computed_status: "approved",
      },
      allUsedPersonToken: true,
    });
  }, 15_000);

  it("refuses all four GitHub read proxy routes with 401 for an unauthenticated caller or invalid token, calling GitHub nothing", async () => {
    const harness = createHarness({ installationRepos: ["acme/app"] });
    const madeUp = `lore_${randomBytes(24).toString("hex")}`;

    const anonymous = await callAllReadProxyRoutes(harness.server, null);
    const invalid = await callAllReadProxyRoutes(harness.server, madeUp);

    expect({
      anonymous: anonymous.map((res) => res.statusCode),
      invalid: invalid.map((res) => res.statusCode),
      githubRequests: harness.githubRequests,
    }).toEqual({
      anonymous: [401, 401, 401, 401],
      invalid: [401, 401, 401, 401],
      githubRequests: [],
    });
  }, 15_000);

  it("refuses all four GitHub read proxy routes with 403 for a repository outside the person's installation list, calling GitHub nothing for it", async () => {
    const harness = createHarness({ installationRepos: ["acme/app"] });
    const token = await signIn(harness.server);

    harness.githubRequests.length = 0;

    const denied = await callAllReadProxyRoutes(harness.server, token, {
      fileRepo: "other/secret",
      readmeRepo: "other/secret",
      detailsRepo: "other/secret",
      pullRepo: "other/secret",
    });

    const secretRequests = harness.githubRequests.filter((req) =>
      req.path.includes("other/secret"),
    );

    expect(denied[0].statusCode).toBe(403);
    expect({
      statuses: denied.map((res) => res.statusCode),
      secretRequests,
    }).toEqual({
      statuses: [403, 403, 403, 403],
      secretRequests: [],
    });
  }, 15_000);

  it("refuses all four GitHub read proxy routes with 500 when the person's stored GitHub token cannot be read, never falling back to the App's token", async () => {
    const harness = createHarness({ installationRepos: ["acme/app"] });
    const token = await signIn(harness.server);

    harness.githubRequests.length = 0;
    delete process.env.LORE_USER_TOKEN_ENCRYPTION_KEY;

    const responses = await callAllReadProxyRoutes(harness.server, token);
    const repoRequests = harness.githubRequests.filter((req) =>
      req.path.startsWith("/repos/acme/app"),
    );

    expect({
      statuses: responses.map((res) => res.statusCode),
      repoRequests,
    }).toEqual({
      statuses: [500, 500, 500, 500],
      repoRequests: [],
    });
  }, 15_000);
});

async function callAllReadProxyRoutes(
  server: ReturnType<typeof buildServer>,
  token: string | null,
  repos = {
    fileRepo: "acme/app",
    readmeRepo: "acme/app",
    detailsRepo: "acme/app",
    pullRepo: "acme/app",
  },
) {
  const headers: Record<string, string> =
    token === null ? {} : { authorization: `Bearer ${token}` };
  const urls = [
    `/api/repos/${repos.fileRepo}/github/file?path=${encodeURIComponent(".github/workflows/lore-ingest.yml")}`,
    `/api/repos/${repos.readmeRepo}/github/readme`,
    `/api/repos/${repos.detailsRepo}/github/details`,
    `/api/repos/${repos.pullRepo}/github/pulls/42`,
  ];

  return Promise.all(
    urls.map((url) => server.inject({ method: "GET", url, headers })),
  );
}

function configureEnv(): void {
  process.env.LORE_INGEST_TOKEN = "legacy-ingest-token";
  process.env.LORE_API_URL = API_URL;
  process.env.LORE_UI_URL = UI_URL;
  process.env.GITHUB_APP_CLIENT_ID = "Iv1.testclient";
  process.env.GITHUB_APP_CLIENT_SECRET = "app-client-secret";
  process.env.GITHUB_APP_INSTALLATION_ID = INSTALLATION_ID;
  process.env.GITHUB_ORG = GITHUB_ORG;
  process.env.LORE_USER_TOKEN_ENCRYPTION_KEY = ENCRYPTION_KEY;
  process.env.GITHUB_TOKEN = APP_TOKEN;
}

function createHarness(config: { installationRepos: string[] }) {
  const state = {
    apiTokens: [] as Array<Record<string, unknown>>,
    sessionTokens: [] as Array<Record<string, unknown>>,
    handoffs: new Map<string, Record<string, unknown>>(),
  };
  const githubRequests: RecordedGithubRequest[] = [];
  const pool = createFakePool(state);

  setPool(pool as never);
  const server = buildServer(() => pool as never);

  globalThis.fetch = createFetchStub(config.installationRepos, githubRequests);

  return { server, githubRequests };
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

function isUserAuth(authorization: string): boolean {
  return (
    authorization.includes(USER_ACCESS_TOKEN) &&
    !authorization.includes(APP_TOKEN)
  );
}

function createFetchStub(
  installationRepos: string[],
  githubRequests: RecordedGithubRequest[],
): typeof fetch {
  return async (input, init) => {
    const req = await resolveFetchRequest(input, init);
    const url = new URL(req.url);

    if (
      url.hostname === "github.com" &&
      url.pathname === "/login/oauth/access_token"
    ) {
      return jsonResponse({
        access_token: USER_ACCESS_TOKEN,
        token_type: "bearer",
        expires_in: 28_800,
        refresh_token: USER_REFRESH_TOKEN,
        refresh_token_expires_in: 15_811_200,
      });
    }

    if (url.hostname === "api.github.com") {
      githubRequests.push({
        method: req.method,
        path: url.pathname,
        authorization: req.authorization,
      });

      return handleGithubApi(url, installationRepos);
    }

    return new Response("not found", { status: 404 });
  };
}

function handleGithubApi(url: URL, installationRepos: string[]): Response {
  const identity = handleIdentity(url, installationRepos);

  if (identity) {
    return identity;
  }

  return (
    handleRepoRead(url) ??
    handlePullRead(url) ??
    new Response("not found", { status: 404 })
  );
}

function handleIdentity(
  url: URL,
  installationRepos: string[],
): Response | null {
  if (url.pathname === "/user") {
    return jsonResponse({
      id: 1001,
      login: "ada",
      name: "Ada",
      avatar_url: "https://avatars.example/ada.png",
    });
  }

  if (
    url.pathname === `/orgs/${GITHUB_ORG}/memberships/ada` ||
    url.pathname === `/user/memberships/orgs/${GITHUB_ORG}`
  ) {
    return jsonResponse({ state: "active", role: "member" });
  }

  if (url.pathname === `/user/installations/${INSTALLATION_ID}/repositories`) {
    return jsonResponse({
      total_count: installationRepos.length,
      repositories: installationRepos.map((fullName) => {
        const [owner, name] = fullName.split("/");

        return { full_name: fullName, name, owner: { login: owner } };
      }),
    });
  }

  return null;
}

function handleRepoRead(url: URL): Response | null {
  if (url.pathname === "/repos/acme/unboarded") {
    return jsonResponse({
      description: "Unboarded repository",
      default_branch: "main",
      html_url: "https://github.com/acme/unboarded",
    });
  }

  if (
    decodeURIComponent(url.pathname) ===
    "/repos/acme/app/contents/.github/workflows/lore-ingest.yml"
  ) {
    return jsonResponse({
      type: "file",
      content: Buffer.from("name: Lore Ingest\n", "utf8").toString("base64"),
    });
  }

  if (url.pathname === "/repos/acme/app/readme") {
    return jsonResponse({
      content: Buffer.from("# App Readme\n", "utf8").toString("base64"),
      download_url: "https://raw.githubusercontent.com/acme/app/main/README.md",
      html_url: "https://github.com/acme/app/blob/main/README.md",
    });
  }

  return null;
}

function handlePullRead(url: URL): Response | null {
  if (url.pathname === "/repos/acme/app/pulls/42") {
    return jsonResponse({
      number: 42,
      title: "Open PR",
      state: "open",
      draft: false,
      merged: false,
      mergeable: true,
      html_url: "https://github.com/acme/app/pull/42",
      head: { sha: "abc1234" },
    });
  }

  if (url.pathname === "/repos/acme/app/commits/abc1234/check-runs") {
    return jsonResponse({
      check_runs: [{ name: "ci", status: "completed", conclusion: "success" }],
    });
  }

  if (url.pathname === "/repos/acme/app/pulls/42/reviews") {
    return jsonResponse([
      {
        user: { login: "ada" },
        state: "APPROVED",
        submitted_at: "2026-11-20T00:00:00Z",
      },
    ]);
  }

  return null;
}

async function resolveFetchRequest(
  input: string | URL | Request,
  init: RequestInit | undefined,
): Promise<{ url: string; method: string; authorization: string }> {
  const initHeaders = init?.headers;

  if (input instanceof Request) {
    return requestObjectInfo(input, init?.method, initHeaders);
  }

  return {
    url: input.toString(),
    method: (init?.method ?? "GET").toUpperCase(),
    authorization: headerValue(initHeaders, "authorization"),
  };
}

function requestObjectInfo(
  input: Request,
  initMethod: string | undefined,
  initHeaders: HeadersInit | undefined,
): { url: string; method: string; authorization: string } {
  return {
    url: input.url,
    method: (initMethod ?? input.method).toUpperCase(),
    authorization:
      headerValue(initHeaders, "authorization") ||
      headerValue(input.headers, "authorization"),
  };
}

function headerValue(headers: HeadersInit | undefined, name: string): string {
  if (!headers) {
    return "";
  }

  if (headers instanceof Headers) {
    return headers.get(name) ?? "";
  }

  return findHeaderEntry(
    Array.isArray(headers) ? headers : Object.entries(headers),
    name.toLowerCase(),
  );
}

function findHeaderEntry(entries: string[][], target: string): string {
  const found = entries.find(([key]) => key.toLowerCase() === target);

  return found?.[1] ?? "";
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function createFakePool(state: {
  apiTokens: Array<Record<string, unknown>>;
  sessionTokens: Array<Record<string, unknown>>;
  handoffs: Map<string, Record<string, unknown>>;
}) {
  const pool = makePool();

  pool.connect.mockImplementation(async () => ({
    query: async (rawSql: string, params: unknown[] = []) =>
      executeSql(state, String(rawSql), params),
    release: vi.fn(),
  }));

  pool.query.mockImplementation(
    async (rawSql: string, params: unknown[] = []) =>
      executeSql(state, String(rawSql), params),
  );

  return pool;
}

function executeSql(
  state: {
    apiTokens: Array<Record<string, unknown>>;
    sessionTokens: Array<Record<string, unknown>>;
    handoffs: Map<string, Record<string, unknown>>;
  },
  sql: string,
  params: unknown[],
): { rows: Array<Record<string, unknown>> } {
  if (
    sql.trim() === "SELECT 1" ||
    sql.includes("information_schema.schemata")
  ) {
    return { rows: [{ ok: 1 }] };
  }

  if (sql.includes("lore.login_handoffs")) {
    return handleHandoffSql(state.handoffs, sql, params);
  }

  if (isSessionTokenSql(sql)) {
    return handleSessionTokenSql(state, sql, params);
  }

  if (sql.includes("pipeline.api_tokens")) {
    return handleApiTokenSql(state, sql, params);
  }

  return { rows: [] };
}

function isSessionTokenSql(sql: string): boolean {
  return (
    sql.includes("pipeline.user_session_tokens") &&
    !sql.trimStart().startsWith("UPDATE pipeline.api_tokens")
  );
}

function handleHandoffSql(
  handoffs: Map<string, Record<string, unknown>>,
  sql: string,
  params: unknown[],
): { rows: Array<Record<string, unknown>> } {
  if (sql.includes("INSERT INTO lore.login_handoffs")) {
    const columns = insertColumnsOf(sql, "lore.login_handoffs");
    const row = mapColumns(columns, params);

    handoffs.set(String(row.code_hash), row);

    return { rows: [] };
  }

  if (!sql.includes("RETURNING")) {
    return { rows: [] };
  }
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

function handleApiTokenSql(
  state: {
    apiTokens: Array<Record<string, unknown>>;
    sessionTokens: Array<Record<string, unknown>>;
  },
  sql: string,
  params: unknown[],
): { rows: Array<Record<string, unknown>> } {
  if (sql.includes("INSERT INTO pipeline.api_tokens")) {
    return insertApiTokenRow(state, sql, params);
  }

  if (sql.includes("UPDATE pipeline.api_tokens")) {
    return updateApiTokenRow(state, sql, params);
  }
  const row = state.apiTokens.find((entry) => entry.token_hash === params[0]);

  return { rows: row ? [projectTokenRow(state, row)] : [] };
}

function insertApiTokenRow(
  state: { apiTokens: Array<Record<string, unknown>> },
  sql: string,
  params: unknown[],
): { rows: Array<Record<string, unknown>> } {
  const columns = insertColumnsOf(sql, "pipeline.api_tokens");
  const row = mapColumns(columns, params);
  const now = new Date(Date.now());
  const stored: Record<string, unknown> = {
    ...row,
    id: randomUUID(),
    created_at: now,
    repos_refreshed_at: row.repos_refreshed_at ?? now,
    revoked_at: null,
  };

  state.apiTokens.push(stored);

  return {
    rows: [
      {
        id: stored.id,
        name: stored.name,
        scopes: stored.scopes,
        created_at: now.toISOString(),
      },
    ],
  };
}

function updateApiTokenRow(
  state: {
    apiTokens: Array<Record<string, unknown>>;
    sessionTokens: Array<Record<string, unknown>>;
  },
  sql: string,
  params: unknown[],
): { rows: Array<Record<string, unknown>> } {
  const row = sql.includes("WHERE id = $1")
    ? state.apiTokens.find((entry) => entry.id === params[0])
    : state.apiTokens.find((entry) => entry.token_hash === params[0]);

  if (!row || row.revoked_at !== null) {
    return { rows: [] };
  }

  if (sql.includes("last_used = now()")) {
    row.last_used = new Date(Date.now());
  }

  return {
    rows: sql.includes("RETURNING") ? [projectTokenRow(state, row)] : [],
  };
}

function handleSessionTokenSql(
  state: { sessionTokens: Array<Record<string, unknown>> },
  sql: string,
  params: unknown[],
): { rows: Array<Record<string, unknown>> } {
  if (sql.includes("INSERT INTO pipeline.user_session_tokens")) {
    const columns = insertColumnsOf(sql, "pipeline.user_session_tokens");

    state.sessionTokens.push(mapColumns(columns, params));

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

function projectTokenRow(
  state: { sessionTokens: Array<Record<string, unknown>> },
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
