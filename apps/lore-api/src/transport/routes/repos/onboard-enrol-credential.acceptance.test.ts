import { randomBytes, randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  LEGACY_TOKEN,
  makePool,
} from "@re-cinq/lore-server-core/test-helpers/http-mock.js";
import { setPool } from "@re-cinq/lore-server-core/platform/db.js";
import { useMirrorOwner } from "@re-cinq/lore-shared/floor/floor-client.js";
import { buildServer } from "../../../app/build-server.js";

const API_URL = "https://lore-api.example.com";
const UI_URL = "https://lore-ui.example.com";
const WEBHOOK_URL = "https://lore-events.example.com/api/events";
const WEBHOOK_SECRET = "webhook-hmac-secret";
const FLOOR_URL = "https://floor.example.com";
const GITHUB_ORG = "acme";
const INSTALLATION_ID = "42";
const APP_TOKEN = "ghs_test_installation";
const USER_ACCESS_TOKEN = "ghu_person_onboard_access";
const USER_REFRESH_TOKEN = "ghr_person_onboard_refresh";
const ENCRYPTION_KEY = randomBytes(32).toString("base64");
const REPO_SECRET_PUBLIC_KEY = randomBytes(32).toString("base64");
const BASE_NOW_MS = new Date("2026-11-22T06:00:00.000Z").getTime();

const ORIGINAL_ENV = { ...process.env };
const ORIGINAL_FETCH = globalThis.fetch;

let nowMs = BASE_NOW_MS;

interface FloorStartCall {
  repo: string;
  startItems: Record<string, { kind: string; ref: string }>;
  rawBody: string;
}

interface RecordedGithubWrite {
  write: string;
  actor: "person" | "app" | "other";
}

describe("Onboarding enrol credential handoff (FR-296)", () => {
  beforeEach(() => {
    nowMs += 600_000;
    vi.useFakeTimers({ now: nowMs, toFake: ["Date"] });
    configureEnv();
    useMirrorOwner(async () => null);
  });

  afterEach(() => {
    vi.useRealTimers();
    process.env = { ...ORIGINAL_ENV };
    globalThis.fetch = ORIGINAL_FETCH;
    setPool(null as never);
  });

  it("carries a person or repository-bound credential for enrol when a signed-in person starts POST /api/onboard", async () => {
    const harness = createHarness();
    const token = await signIn(harness.server);
    const baselineSqlCount = harness.sqlCalls.length;

    const response = await harness.server.inject({
      method: "POST",
      url: "/api/onboard",
      headers: { authorization: `Bearer ${token}` },
      payload: { repo: "acme/new-repo" },
    });

    expect({
      status: response.statusCode,
      hasHandoff: hasCredentialOrActorHandoff(harness, baselineSqlCount),
      leaksAppCredential: floorContainsSecret(harness),
    }).toEqual({
      status: 200,
      hasHandoff: true,
      leaksAppCredential: false,
    });
  });

  it("starts the onboard run without a person credential when POST /api/onboard is called with a wide service token", async () => {
    const harness = createHarness();

    const response = await harness.server.inject({
      method: "POST",
      url: "/api/onboard",
      headers: { authorization: `Bearer ${LEGACY_TOKEN}` },
      payload: { repo: "acme/other-repo" },
    });

    expect({
      status: response.statusCode,
      githubWrites: harness.githubWrites,
      floorRuns: floorRunSummaries(harness),
    }).toEqual({
      status: 200,
      githubWrites: [
        { write: "POST /repos/acme/other-repo/hooks", actor: "app" },
        { write: "POST /repos/acme/other-repo/hooks/77/pings", actor: "app" },
        { write: "POST /repos/acme/other-repo/git/refs", actor: "app" },
      ],
      floorRuns: [
        {
          repo: "github.com/acme/other-repo",
          target: "github.com/acme/other-repo@lore/onboard/task-1",
          items: ["repo", "task_id", "ticket"],
        },
      ],
    });
  });

  it("hands no credential and never the App's token to the onboard run when POST /api/onboard is called with a wide service token", async () => {
    const harness = createHarness();

    const response = await harness.server.inject({
      method: "POST",
      url: "/api/onboard",
      headers: { authorization: `Bearer ${LEGACY_TOKEN}` },
      payload: { repo: "acme/new-repo" },
    });

    expect({
      status: response.statusCode,
      startItems: harness.floorStarts.map((start) =>
        Object.keys(start.startItems).sort(),
      ),
      leaksAppCredential: floorContainsSecret(harness),
    }).toEqual({
      status: 200,
      startItems: [["repo", "task_id", "ticket"]],
      leaksAppCredential: false,
    });
  });

  it("makes the onboarding changes as the App on the named repository and hands no person credential to the onboard run when POST /api/onboard is called with a token a person minted", async () => {
    const harness = createHarness();
    const sessionToken = await signIn(harness.server);
    const mintedToken = await mintAdminToken(harness.server, sessionToken);

    const response = await harness.server.inject({
      method: "POST",
      url: "/api/onboard",
      headers: { authorization: `Bearer ${mintedToken}` },
      payload: { repo: "acme/other-repo" },
    });

    expect({
      status: response.statusCode,
      githubWrites: harness.githubWrites,
      floorRuns: floorRunSummaries(harness),
      leaksCredential: floorContainsSecret(harness, [
        USER_ACCESS_TOKEN,
        USER_REFRESH_TOKEN,
        mintedToken,
      ]),
    }).toEqual({
      status: 200,
      githubWrites: [
        { write: "POST /repos/acme/other-repo/hooks", actor: "app" },
        { write: "POST /repos/acme/other-repo/hooks/77/pings", actor: "app" },
        { write: "POST /repos/acme/other-repo/git/refs", actor: "app" },
      ],
      floorRuns: [
        {
          repo: "github.com/acme/other-repo",
          target: "github.com/acme/other-repo@lore/onboard/task-1",
          items: ["repo", "task_id", "ticket"],
        },
      ],
      leaksCredential: false,
    });
  });

  it("refuses POST /api/onboard with 401 for a caller with no token or a made-up token, starting no onboard run", async () => {
    const harness = createHarness();

    const anonymous = await harness.server.inject({
      method: "POST",
      url: "/api/onboard",
      payload: { repo: "acme/new-repo" },
    });
    const madeUp = await harness.server.inject({
      method: "POST",
      url: "/api/onboard",
      headers: { authorization: "Bearer lore_made_up_token" },
      payload: { repo: "acme/new-repo" },
    });

    expect({
      statuses: [anonymous.statusCode, madeUp.statusCode],
      starts: harness.floorStarts.length,
      blobs: harness.floorBlobs.length,
    }).toEqual({ statuses: [401, 401], starts: 0, blobs: 0 });
  });

  it("refuses a signed-in person POST /api/onboard for a repository outside the ones they may open, carrying no credential to any run", async () => {
    const harness = createHarness();
    const token = await signIn(harness.server);

    const response = await harness.server.inject({
      method: "POST",
      url: "/api/onboard",
      headers: { authorization: `Bearer ${token}` },
      payload: { repo: "acme/someone-elses-repo" },
    });

    expect({
      status: response.statusCode,
      starts: harness.floorStarts.length,
      blobs: harness.floorBlobs.length,
    }).toEqual({ status: 403, starts: 0, blobs: 0 });
  });

  it("refuses POST /api/onboard for a signed-in person whose lapsed GitHub token GitHub will not refresh, never handing the App's token to the onboard run", async () => {
    const harness = createHarness();
    const token = await signIn(harness.server);
    const answered = globalThis.fetch;

    for (const row of harness.state.sessionTokens) {
      row.access_token_expires_at = new Date(Date.now() - 60_000);
    }
    globalThis.fetch = async (input, init) =>
      String(input instanceof Request ? input.url : input).includes(
        "/login/oauth/access_token",
      )
        ? jsonResponse({ error: "bad_refresh_token" })
        : answered(input, init);

    const response = await harness.server.inject({
      method: "POST",
      url: "/api/onboard",
      headers: { authorization: `Bearer ${token}` },
      payload: { repo: "acme/new-repo" },
    });

    expect({
      refused: response.statusCode >= 400,
      starts: harness.floorStarts.length,
      leaksAppCredential: floorContainsSecret(harness),
    }).toEqual({ refused: true, starts: 0, leaksAppCredential: false });
  });
});

function hasCredentialOrActorHandoff(
  harness: ReturnType<typeof createHarness>,
  baselineSqlCount: number,
): boolean {
  const start = harness.floorStarts[0];

  if (!start) {
    return false;
  }

  const baseKeys = new Set(["repo", "task_id", "ticket"]);
  const hasExtraStartItem = Object.keys(start.startItems).some(
    (key) => !baseKeys.has(key),
  );

  return (
    hasExtraStartItem ||
    harness.floorBlobs.length > 1 ||
    hasPersistedActorOrToken(
      harness.state,
      harness.sqlCalls.slice(baselineSqlCount),
    )
  );
}

function hasPersistedActorOrToken(
  state: PoolState,
  sqlCalls: Array<{ sql: string; params: unknown[] }>,
): boolean {
  const mintedToken = sqlCalls.some((call) =>
    call.sql.includes("INSERT INTO pipeline.api_tokens"),
  );
  const sessionIds = state.apiTokens.map((row) => String(row.id));
  const taskWrites = sqlCalls.filter((call) =>
    call.sql.includes("pipeline.tasks"),
  );
  const hasActorTaskField = taskWrites.some((call) =>
    call.params.some(
      (param) =>
        typeof param === "string" &&
        (param.includes("ada") ||
          param.includes("1001") ||
          sessionIds.some((id) => param.includes(id))),
    ),
  );

  return mintedToken || hasActorTaskField;
}

function floorRunSummaries(harness: ReturnType<typeof createHarness>) {
  return harness.floorStarts.map((start) => ({
    repo: start.repo,
    target: start.startItems.repo?.ref ?? "",
    items: Object.keys(start.startItems).sort(),
  }));
}

function floorContainsSecret(
  harness: ReturnType<typeof createHarness>,
  extraSecrets: string[] = [],
): boolean {
  const secrets = [APP_TOKEN, ENCRYPTION_KEY, ...extraSecrets];
  const payloads = [
    ...harness.floorBlobs,
    ...harness.floorStarts.map((start) => start.rawBody),
  ];

  return payloads.some((text) =>
    secrets.some((secret) => text.includes(secret)),
  );
}

function configureEnv(): void {
  process.env.LORE_INGEST_TOKEN = LEGACY_TOKEN;
  process.env.LORE_INGEST_URL = API_URL;
  process.env.LORE_API_URL = API_URL;
  process.env.LORE_UI_URL = UI_URL;
  process.env.LORE_WEBHOOK_URL = WEBHOOK_URL;
  process.env.LORE_WEBHOOK_SECRET = WEBHOOK_SECRET;
  process.env.FLOOR_API_URL = FLOOR_URL;
  process.env.FLOOR_SERVICE_TOKEN = "floor-service-token";
  process.env.GITHUB_APP_CLIENT_ID = "Iv1.testclient";
  process.env.GITHUB_APP_CLIENT_SECRET = "app-client-secret";
  process.env.GITHUB_APP_INSTALLATION_ID = INSTALLATION_ID;
  process.env.GITHUB_ORG = GITHUB_ORG;
  process.env.LORE_USER_TOKEN_ENCRYPTION_KEY = ENCRYPTION_KEY;
  process.env.GITHUB_TOKEN = APP_TOKEN;
}

function createHarness() {
  const state = {
    repos: [] as Array<Record<string, unknown>>,
    apiTokens: [] as Array<Record<string, unknown>>,
    sessionTokens: [] as Array<Record<string, unknown>>,
    handoffs: new Map<string, Record<string, unknown>>(),
  };
  const sqlCalls: Array<{ sql: string; params: unknown[] }> = [];
  const floorStarts: FloorStartCall[] = [];
  const floorBlobs: string[] = [];
  const githubWrites: RecordedGithubWrite[] = [];
  const pool = createFakePool(state, sqlCalls);

  setPool(pool as never);
  const server = buildServer(() => pool as never);

  globalThis.fetch = createFetchStub({ floorStarts, floorBlobs, githubWrites });

  return { server, state, sqlCalls, floorStarts, floorBlobs, githubWrites };
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

async function mintAdminToken(
  server: ReturnType<typeof buildServer>,
  sessionToken: string,
): Promise<string> {
  const mintRes = await server.inject({
    method: "POST",
    url: "/api/tokens",
    headers: { authorization: `Bearer ${sessionToken}` },
    payload: { name: "person-admin", scopes: ["admin"] },
  });

  return (mintRes.result as { token: string }).token;
}

function createFetchStub(recorded: {
  floorStarts: FloorStartCall[];
  floorBlobs: string[];
  githubWrites: RecordedGithubWrite[];
}): typeof fetch {
  return async (input, init) => {
    const request = await resolveFetchRequest(input, init);
    const url = new URL(request.url);

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
      return handleGithubApiFetch(url, request, recorded.githubWrites);
    }

    if (url.hostname === "floor.example.com") {
      return handleFloorFetch(url, request.bodyText, recorded);
    }

    return new Response("not found", { status: 404 });
  };
}

async function resolveFetchRequest(
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
): Promise<{
  url: string;
  method: string;
  authorization: string;
  bodyText: string;
}> {
  return {
    url: input.url,
    method: (init?.method ?? input.method).toUpperCase(),
    authorization:
      headerOf(init?.headers, "authorization") ||
      input.headers.get("authorization") ||
      "",
    bodyText: await input.clone().text(),
  };
}

function requestFromInit(
  input: string | URL,
  init: RequestInit | undefined,
): {
  url: string;
  method: string;
  authorization: string;
  bodyText: string;
} {
  return {
    url: input.toString(),
    method: (init?.method ?? "GET").toUpperCase(),
    authorization: headerOf(init?.headers, "authorization"),
    bodyText: typeof init?.body === "string" ? init.body : "",
  };
}

function headerOf(headers: HeadersInit | undefined, name: string): string {
  if (!headers) {
    return "";
  }

  if (headers instanceof Headers) {
    return headers.get(name) ?? "";
  }

  return headerFromEntries(headers, name.toLowerCase());
}

function headerFromEntries(
  headers: Exclude<HeadersInit, Headers>,
  target: string,
): string {
  const entries = Array.isArray(headers) ? headers : Object.entries(headers);

  return entries.find(([key]) => key.toLowerCase() === target)?.[1] ?? "";
}

function handleGithubApiFetch(
  url: URL,
  request: { method: string; authorization: string },
  githubWrites: RecordedGithubWrite[],
): Response {
  const identityReply = handleIdentityFetch(url);

  if (identityReply) {
    return identityReply;
  }

  const reply = handleRepoOnboardGithub(url, request.method);

  if (request.method !== "GET" && reply.status < 400) {
    githubWrites.push({
      write: `${request.method} ${decodeURIComponent(url.pathname)}`,
      actor: githubActorOf(request.authorization),
    });
  }

  return reply;
}

function githubActorOf(authorization: string): "person" | "app" | "other" {
  if (authorization.includes(USER_ACCESS_TOKEN)) {
    return "person";
  }

  return authorization.includes(APP_TOKEN) ? "app" : "other";
}

function handleIdentityFetch(url: URL): Response | null {
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
      total_count: 1,
      repositories: [
        {
          full_name: "acme/new-repo",
          name: "new-repo",
          owner: { login: "acme" },
        },
      ],
    });
  }

  if (
    /^\/repos\/[^/]+\/[^/]+\/collaborators\/[^/]+\/permission$/.test(
      url.pathname,
    )
  ) {
    return jsonResponse({ permission: "admin" });
  }

  return null;
}

function handleRepoOnboardGithub(url: URL, method: string): Response {
  const key = `${method} ${decodeURIComponent(url.pathname)}`;

  if (/^GET \/repos\/[^/]+\/[^/]+$/.test(key)) {
    return jsonResponse({ default_branch: "main" });
  }

  if (/^GET \/repos\/[^/]+\/[^/]+\/git\/ref\/heads\/main$/.test(key)) {
    return jsonResponse({ object: { sha: "abc123" } });
  }

  if (/^POST \/repos\/[^/]+\/[^/]+\/git\/refs$/.test(key)) {
    return jsonResponse({ ref: "refs/heads/lore/onboard/task-1" }, 201);
  }

  if (/^GET \/repos\/[^/]+\/[^/]+\/actions\/secrets\/public-key$/.test(key)) {
    return jsonResponse({ key_id: "key-1", key: REPO_SECRET_PUBLIC_KEY });
  }

  return handleRepoWebhookAndSecrets(key);
}

function handleRepoWebhookAndSecrets(key: string): Response {
  const secretOrVar = handleSecretOrVariable(key);

  if (secretOrVar) {
    return secretOrVar;
  }

  return handleWebhookKey(key);
}

function handleSecretOrVariable(key: string): Response | null {
  if (/^PUT \/repos\/[^/]+\/[^/]+\/actions\/secrets\/[^/]+$/.test(key)) {
    return new Response(null, { status: 204 });
  }

  if (/^PATCH \/repos\/[^/]+\/[^/]+\/actions\/variables\/[^/]+$/.test(key)) {
    return new Response("not found", { status: 404 });
  }

  if (/^POST \/repos\/[^/]+\/[^/]+\/actions\/variables$/.test(key)) {
    return new Response(null, { status: 201 });
  }

  return null;
}

function handleWebhookKey(key: string): Response {
  if (/^GET \/repos\/[^/]+\/[^/]+\/hooks$/.test(key)) {
    return jsonResponse([]);
  }

  if (/^POST \/repos\/[^/]+\/[^/]+\/hooks$/.test(key)) {
    return jsonResponse({ id: 77, active: true }, 201);
  }

  if (/^POST \/repos\/[^/]+\/[^/]+\/hooks\/\d+\/pings$/.test(key)) {
    return new Response(null, { status: 204 });
  }

  return new Response("not found", { status: 404 });
}

function handleFloorFetch(
  url: URL,
  bodyText: string,
  recorded: { floorStarts: FloorStartCall[]; floorBlobs: string[] },
): Response {
  if (url.pathname === "/blobs") {
    recorded.floorBlobs.push(bodyText);

    return jsonResponse(
      {
        hash: `sha256-${String(recorded.floorBlobs.length).padStart(64, "a")}`,
      },
      201,
    );
  }

  if (url.pathname === "/assembly-lines/onboard/start") {
    const parsed = JSON.parse(bodyText) as {
      repo: string;
      startItems: Record<string, { kind: string; ref: string }>;
    };

    recorded.floorStarts.push({
      repo: parsed.repo,
      startItems: parsed.startItems,
      rawBody: bodyText,
    });

    return jsonResponse({ run: { id: "run-1" } }, 201);
  }

  return new Response("not found", { status: 404 });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

interface PoolState {
  repos: Array<Record<string, unknown>>;
  apiTokens: Array<Record<string, unknown>>;
  sessionTokens: Array<Record<string, unknown>>;
  handoffs: Map<string, Record<string, unknown>>;
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
    copyMutableArrays(committed, tx.staged);

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

function copyMutableArrays(target: PoolState, source: PoolState): void {
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

function executePoolSql(
  state: PoolState,
  sql: string,
  params: unknown[],
): { rows: Array<Record<string, unknown>> } {
  if (
    sql.trim() === "SELECT 1" ||
    sql.includes("information_schema.schemata")
  ) {
    return { rows: [{ ok: 1 }] };
  }

  if (sql.includes("FROM information_schema.tables")) {
    return { rows: [{ table_schema: "org_shared" }] };
  }

  if (sql.includes("lore.login_handoffs")) {
    return handleHandoffSql(state.handoffs, sql, params);
  }

  return executeDomainSql(state, sql, params);
}

function executeDomainSql(
  state: PoolState,
  sql: string,
  params: unknown[],
): { rows: Array<Record<string, unknown>> } {
  if (sql.includes("pipeline.api_tokens")) {
    return handleApiTokensSql(state, sql, params);
  }

  if (sql.includes("pipeline.user_session_tokens")) {
    return handleSessionTokensSql(state, sql, params);
  }

  if (sql.includes("pipeline.tasks")) {
    return handleTasksSql(sql);
  }

  if (sql.includes("lore.repos")) {
    return handleReposSql(state.repos, sql, params);
  }

  return { rows: [] };
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

  const row = state.apiTokens.find((entry) => entry.token_hash === params[0]);

  return { rows: row ? [projectTokenRow(state, row)] : [] };
}

function insertApiToken(
  state: PoolState,
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

function handleTasksSql(sql: string): {
  rows: Array<Record<string, unknown>>;
} {
  if (sql.includes("INSERT INTO pipeline.tasks")) {
    return {
      rows: [
        {
          id: "task-1",
          task_type: "onboard",
          status: "pending",
          priority: "normal",
          created_at: new Date(Date.now()).toISOString(),
        },
      ],
    };
  }

  if (sql.includes("UPDATE pipeline.tasks")) {
    return { rows: [{ id: "task-1" }] };
  }

  return { rows: [] };
}

function handleReposSql(
  repos: Array<Record<string, unknown>>,
  sql: string,
  params: unknown[],
): { rows: Array<Record<string, unknown>> } {
  if (!sql.includes("INSERT INTO lore.repos")) {
    return { rows: [] };
  }
  const fullName = String(params[2]);
  const existing = repos.find((repo) => repo.fullName === fullName);

  if (existing) {
    return { rows: [{ id: existing.id }] };
  }
  const added = { id: randomUUID(), fullName };

  repos.push(added);

  return { rows: [{ id: added.id }] };
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
