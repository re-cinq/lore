import { createHash, generateKeyPairSync } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  LEGACY_TOKEN,
  makePool,
  useRateLimitSafeClock,
} from "@re-cinq/lore-server-core/test-helpers/http-mock.js";
import { buildServer } from "../../app/build-server.js";

const originalEnv = { ...process.env };
const originalFetch = globalThis.fetch;

const BEN_TOKEN = "ben-session";
const DANA_TOKEN = "dana-session";
const ALICE_TOKEN = "alice-session";

const APP_PRIVATE_KEY = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
}).privateKey;

describe("repository guard route coverage and GitHub permission levels", () => {
  useRateLimitSafeClock();

  beforeEach(() => {
    process.env.LORE_INGEST_TOKEN = LEGACY_TOKEN;
    process.env.GITHUB_APP_ID = "999";
    process.env.GITHUB_APP_PRIVATE_KEY = APP_PRIVATE_KEY;
    process.env.GITHUB_APP_INSTALLATION_ID = "12345";
    delete process.env.GITHUB_TOKEN;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    globalThis.fetch = originalFetch;
  });

  it("refuses GET /api/context-evals/documents?repo= with 403 for a person who cannot read that repository", async () => {
    const { call, sqlCalls } = createLoreServer({
      "other/secret:ben": { status: 404 },
      "acme/app:ben": { status: 200, permission: "read" },
    });
    const denied = await call(
      "GET",
      "/api/context-evals/documents?repo=other/secret",
      BEN_TOKEN,
    );
    const queriedChunksOnDenial = sqlCalls.some((sql) =>
      sql.includes(".chunks"),
    );
    const allowed = await call(
      "GET",
      "/api/context-evals/documents?repo=acme/app",
      BEN_TOKEN,
    );

    expect({
      deniedStatus: denied.statusCode,
      deniedBody: denied.result,
      queriedChunksOnDenial,
      allowedStatus: allowed.statusCode,
    }).toEqual({
      deniedStatus: 403,
      deniedBody: { error: "repository not allowed" },
      queriedChunksOnDenial: false,
      allowedStatus: 200,
    });
  });

  it("refuses GET /api/chunk-types?repo= with 403 for a person who cannot read that repository", async () => {
    const { call, sqlCalls } = createLoreServer({
      "other/secret:ben": { status: 404 },
      "acme/app:ben": { status: 200, permission: "read" },
    });
    const denied = await call(
      "GET",
      "/api/chunk-types?repo=other/secret",
      BEN_TOKEN,
    );
    const queriedChunksOnDenial = sqlCalls.some((sql) =>
      sql.includes(".chunks"),
    );
    const allowed = await call(
      "GET",
      "/api/chunk-types?repo=acme/app",
      BEN_TOKEN,
    );

    expect({
      deniedStatus: denied.statusCode,
      deniedBody: denied.result,
      queriedChunksOnDenial,
      allowedStatus: allowed.statusCode,
    }).toEqual({
      deniedStatus: 403,
      deniedBody: { error: "repository not allowed" },
      queriedChunksOnDenial: false,
      allowedStatus: 200,
    });
  });

  it("refuses GET /api/repo-status?repo= with 403 for a person who cannot read that repository", async () => {
    const { call, sqlCalls } = createLoreServer({
      "other/secret:ben": { status: 404 },
      "acme/app:ben": { status: 200, permission: "read" },
    });
    const denied = await call(
      "GET",
      "/api/repo-status?repo=other/secret",
      BEN_TOKEN,
    );
    const queriedReposOnDenial = sqlCalls.some((sql) =>
      sql.includes("FROM lore.repos"),
    );
    const allowed = await call(
      "GET",
      "/api/repo-status?repo=acme/app",
      BEN_TOKEN,
    );

    expect({
      deniedStatus: denied.statusCode,
      deniedBody: denied.result,
      queriedReposOnDenial,
      allowedStatus: allowed.statusCode,
    }).toEqual({
      deniedStatus: 403,
      deniedBody: { error: "repository not allowed" },
      queriedReposOnDenial: false,
      allowedStatus: 200,
    });
  });

  it("answers a person 403 when the level GitHub reports for them on the repository is below the level the route declares", async () => {
    const { call, sqlCalls } = createLoreServer({
      "acme/app:ben": { status: 200, permission: "read" },
      "acme/app:dana": { status: 200, permission: "write" },
      "acme/app:alice": { status: 200, permission: "admin" },
    });
    const readOnWriteRoute = await call("POST", "/api/ingest", BEN_TOKEN, {
      repo: "acme/app",
      files: [{ path: "README.md", content: "blocked" }],
    });
    const writesAfterReadDenied = sqlCalls.filter(isDataWrite);
    const writeOnWriteRoute = await call("POST", "/api/ingest", DANA_TOKEN, {
      repo: "acme/app",
      files: [],
    });

    expect({
      readOnWrite: [readOnWriteRoute.statusCode, readOnWriteRoute.result],
      writesAfterReadDenied,
      writeOnWrite: writeOnWriteRoute.statusCode,
    }).toEqual({
      readOnWrite: [403, { error: "repository not allowed" }],
      writesAfterReadDenied: [],
      writeOnWrite: 200,
    });

    const sqlCountBeforeAdminDenied = sqlCalls.length;
    const writeOnAdminRoute = await call(
      "POST",
      "/api/repos/acme/app/mirror/move",
      DANA_TOKEN,
      { dry_run: true },
    );
    const repoQueriesOnAdminDenied = sqlCalls
      .slice(sqlCountBeforeAdminDenied)
      .some((sql) => sql.includes("FROM lore.repos"));
    const adminOnAdminRoute = await call(
      "POST",
      "/api/repos/acme/app/mirror/move",
      ALICE_TOKEN,
      { dry_run: true },
    );

    expect({
      writeOnAdmin: [writeOnAdminRoute.statusCode, writeOnAdminRoute.result],
      repoQueriesOnAdminDenied,
      adminOnAdmin: adminOnAdminRoute.statusCode,
    }).toEqual({
      writeOnAdmin: [403, { error: "repository not allowed" }],
      repoQueriesOnAdminDenied: false,
      adminOnAdmin: 200,
    });
  });

  it("learns a person's level by asking GitHub, as the App, about that person", async () => {
    const { call, githubCalls } = createLoreServer({
      "acme/app:ben": { status: 200, permission: "write" },
      "acme/other:ben": { status: 200, permission: "read" },
    });
    const allowedWrite = await call("POST", "/api/ingest", BEN_TOKEN, {
      repo: "acme/app",
      files: [],
    });
    const deniedWrite = await call("POST", "/api/ingest", BEN_TOKEN, {
      repo: "acme/other",
      files: [],
    });
    const appTokenCall = githubCalls.find(
      (entry) =>
        entry.method === "POST" &&
        entry.path === "/app/installations/12345/access_tokens",
    );
    const permissionLookups = githubCalls
      .filter((entry) => entry.path.includes("/collaborators/"))
      .map((entry) => ({
        method: entry.method,
        path: entry.path,
        auth: entry.authorization,
      }));

    expect({
      statuses: [allowedWrite.statusCode, deniedWrite.statusCode],
      usedAppJwtForToken: /^bearer /i.test(appTokenCall?.authorization ?? ""),
      permissionLookups,
    }).toEqual({
      statuses: [200, 403],
      usedAppJwtForToken: true,
      permissionLookups: [
        {
          method: "GET",
          path: "/repos/acme/app/collaborators/ben/permission",
          auth: "token ghs_app_installation_token",
        },
        {
          method: "GET",
          path: "/repos/acme/other/collaborators/ben/permission",
          auth: "token ghs_app_installation_token",
        },
      ],
    });
  });

  it("refuses the three repo read routes with 401 for a caller with no credential or a made-up one, before any data query", async () => {
    const { server, call, sqlCalls } = createLoreServer({
      "acme/app:ben": { status: 200, permission: "read" },
    });
    const statuses: Record<string, number[]> = {};

    for (const route of GUARDED_READ_ROUTES) {
      const anonymous = await server.inject({
        method: "GET",
        url: `${route.path}?repo=acme/app`,
      });
      const madeUp = await call(
        "GET",
        `${route.path}?repo=acme/app`,
        "made-up-session",
      );

      statuses[route.path] = [anonymous.statusCode, madeUp.statusCode];
    }

    expect({
      statuses,
      readData: sqlCalls.filter(readsGuardedData),
    }).toEqual({
      statuses: Object.fromEntries(
        GUARDED_READ_ROUTES.map((route) => [route.path, [401, 401]]),
      ),
      readData: [],
    });
  });

  it("refuses the three repo read routes with 403 when GitHub answers the permission lookup with an error", async () => {
    const { call, sqlCalls } = createLoreServer({
      "other/secret:ben": { status: 403 },
      "other/private:ben": { status: 422 },
    });
    const statuses: Record<string, number[]> = {};

    for (const route of GUARDED_READ_ROUTES) {
      const forbidden = await call(
        "GET",
        `${route.path}?repo=other/secret`,
        BEN_TOKEN,
      );
      const unprocessable = await call(
        "GET",
        `${route.path}?repo=other/private`,
        BEN_TOKEN,
      );

      statuses[route.path] = [forbidden.statusCode, unprocessable.statusCode];
    }

    expect({
      statuses,
      readData: sqlCalls.filter(readsGuardedData),
    }).toEqual({
      statuses: Object.fromEntries(
        GUARDED_READ_ROUTES.map((route) => [route.path, [403, 403]]),
      ),
      readData: [],
    });
  });

  it("refuses the three repo read routes with 403 when GitHub answers the permission lookup with something that is not a permission", async () => {
    const { call, sqlCalls } = createLoreServer({});
    const githubStub = globalThis.fetch;

    globalThis.fetch = async (input, init) => {
      const url = new URL(typeof input === "string" ? input : input.toString());

      if (url.pathname === "/repos/other/secret/collaborators/ben/permission") {
        return jsonResponse({ permission: "superuser", role_name: "owner" });
      }

      if (url.pathname === "/repos/other/html/collaborators/ben/permission") {
        return new Response("<html>ok</html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        });
      }

      return githubStub(input, init);
    };
    const statuses: Record<string, number[]> = {};

    for (const route of GUARDED_READ_ROUTES) {
      const unknownLevel = await call(
        "GET",
        `${route.path}?repo=other/secret`,
        BEN_TOKEN,
      );
      const htmlReply = await call(
        "GET",
        `${route.path}?repo=other/html`,
        BEN_TOKEN,
      );

      statuses[route.path] = [unknownLevel.statusCode, htmlReply.statusCode];
    }

    expect({
      statuses,
      readData: sqlCalls.filter(readsGuardedData),
    }).toEqual({
      statuses: Object.fromEntries(
        GUARDED_READ_ROUTES.map((route) => [route.path, [403, 403]]),
      ),
      readData: [],
    });
  });

  it("refuses the three repo read routes when the repo parameter is repeated to slip a second repository past the guard", async () => {
    const { call, sqlCalls } = createLoreServer({
      "other/secret:ben": { status: 404 },
      "acme/app:ben": { status: 200, permission: "read" },
    });
    const statuses: Record<string, number> = {};

    for (const route of GUARDED_READ_ROUTES) {
      const repeated = await call(
        "GET",
        `${route.path}?repo=acme/app&repo=other/secret`,
        BEN_TOKEN,
      );

      statuses[route.path] = repeated.statusCode;
    }

    expect({
      statuses,
      readData: sqlCalls.filter(readsGuardedData),
    }).toEqual({
      statuses: Object.fromEntries(
        GUARDED_READ_ROUTES.map((route) => [route.path, 400]),
      ),
      readData: [],
    });
  });

  it("answers GET /api/repo-status without a repo parameter with onboarded false, reading no repository data", async () => {
    const { call, sqlCalls, githubCalls } = createLoreServer({});
    const response = await call("GET", "/api/repo-status", BEN_TOKEN);

    expect({
      status: response.statusCode,
      body: response.result,
      readData: sqlCalls.filter(readsGuardedData),
      githubCalls,
    }).toEqual({
      status: 200,
      body: { onboarded: false },
      readData: [],
      githubCalls: [],
    });
  });

  it("answers GET /api/chunk-types without a repo parameter with every repository's content types and asks GitHub about no repository", async () => {
    const { call, githubCalls } = createLoreServer({
      "other/secret:ben": { status: 404 },
    });
    const response = await call("GET", "/api/chunk-types", BEN_TOKEN);

    expect({
      status: response.statusCode,
      body: response.result,
      githubCalls,
    }).toEqual({
      status: 200,
      body: { types: ["spec", "adr"] },
      githubCalls: [],
    });
  });
});

interface PermissionReply {
  status: number;
  permission?: "admin" | "write" | "read" | "none";
}

interface RecordedGithubCall {
  method: string;
  path: string;
  authorization: string;
}

function createLoreServer(permissions: Record<string, PermissionReply>) {
  const pool = makePool();
  const sqlCalls: string[] = [];
  const githubCalls: RecordedGithubCall[] = [];

  globalThis.fetch = createGithubFetchStub(permissions, githubCalls);
  pool.query.mockImplementation((rawSql: string, params?: unknown[]) => {
    const sql = String(rawSql);

    sqlCalls.push(sql);

    return Promise.resolve({ rows: queryRowsFor(sql, params) });
  });
  Object.assign(pool, {
    connect: async () => ({
      query: pool.query,
      release: () => undefined,
    }),
  });

  const server = buildServer(() => pool as never);

  return {
    server,
    sqlCalls,
    githubCalls,
    call: (
      method: "GET" | "POST",
      url: string,
      token: string,
      payload?: object,
    ) =>
      server.inject({
        method,
        url,
        payload,
        headers: { authorization: `Bearer ${token}` },
      }),
  };
}

function createGithubFetchStub(
  permissions: Record<string, PermissionReply>,
  recorded: RecordedGithubCall[],
): typeof fetch {
  return async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input.toString());
    const method = (init?.method ?? "GET").toUpperCase();
    const authorization = headerValue(init?.headers, "authorization");

    recorded.push({ method, path: url.pathname, authorization });

    return githubReplyFor(url.pathname, permissions);
  };
}

function githubReplyFor(
  pathname: string,
  permissions: Record<string, PermissionReply>,
): Response {
  if (pathname === "/app/installations/12345/access_tokens") {
    return jsonResponse({
      token: "ghs_app_installation_token",
      expires_at: "2026-11-22T00:00:00Z",
    });
  }

  const match =
    /^\/repos\/([^/]+)\/([^/]+)\/collaborators\/([^/]+)\/permission$/.exec(
      pathname,
    );

  return match
    ? permissionResponse(permissions, match)
    : jsonResponse({ message: "not found" }, 404);
}

function permissionResponse(
  permissions: Record<string, PermissionReply>,
  match: RegExpExecArray,
): Response {
  const key = `${match[1]}/${match[2]}:${match[3]}`;
  const reply = permissions[key];

  if (!reply || reply.status >= 400) {
    return jsonResponse({ message: "not found" }, reply?.status ?? 404);
  }

  return jsonResponse({ permission: reply.permission ?? "none" });
}

function headerValue(headers: HeadersInit | undefined, name: string): string {
  return new Headers(headers).get(name) ?? "";
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function isDataWrite(sql: string): boolean {
  return (
    /\b(INSERT|UPDATE|DELETE)\b/i.test(sql) &&
    !sql.includes("UPDATE pipeline.api_tokens")
  );
}

const QUERY_HANDLERS: Array<{
  match: (sql: string) => boolean;
  rows: (sql: string, params: unknown[] | undefined) => unknown[];
}> = [
  {
    match: (sql) => sql.includes("UPDATE pipeline.api_tokens"),
    rows: (_sql, params) => tokenRows(params),
  },
  {
    match: (sql) => sql.includes("information_schema.tables"),
    rows: () => [{ table_schema: "platform" }],
  },
  {
    match: (sql) => sql.includes("information_schema.schemata"),
    rows: () => [{ schema_name: "platform" }],
  },
  {
    match: (sql) => sql.includes("moved") && sql.includes("held"),
    rows: () => [{ moved: 0, held: 0 }],
  },
  {
    match: (sql) => sql.includes("FROM lore.repos"),
    rows: (_sql, params) => repoRows(params),
  },
  {
    match: (sql) => sql.includes("SELECT DISTINCT content_type"),
    rows: (sql, params) => chunkTypeRows(sql, params),
  },
  {
    match: (sql) => sql.includes("SELECT DISTINCT ON (file_path)"),
    rows: () => [
      {
        file_path: "specs/example/spec.md",
        head: "| Status | Shipped |",
      },
    ],
  },
  {
    match: (sql) => sql.includes("SELECT count(*) as c"),
    rows: () => [{ c: 0 }],
  },
];

function queryRowsFor(sql: string, params: unknown[] | undefined): unknown[] {
  const matched = QUERY_HANDLERS.find((entry) => entry.match(sql));

  return matched ? matched.rows(sql, params) : [];
}

function repoRows(params: unknown[] | undefined) {
  const named = typeof params?.[0] === "string" ? params[0].toLowerCase() : "";

  if (named === "other/secret") {
    return [
      {
        id: "r-secret",
        owner: "other",
        name: "secret",
        full_name: "other/secret",
        team: "platform",
        onboarded_at: new Date("2026-11-18T00:00:00Z"),
        last_ingested_at: "2026-11-18T00:00:00Z",
        onboarding_pr_url: null,
        onboarding_pr_merged: false,
        settings: {},
        outcome_stats: null,
      },
    ];
  }

  return [
    {
      id: "r-acme",
      owner: "acme",
      name: "app",
      full_name: "acme/app",
      team: "platform",
      onboarded_at: new Date("2026-11-18T00:00:00Z"),
      last_ingested_at: "2026-11-18T00:00:00Z",
      onboarding_pr_url: null,
      onboarding_pr_merged: false,
      settings: { public_mirror: "acme/app-public" },
      outcome_stats: null,
    },
  ];
}

const CHUNK_TYPES_BY_REPO = [
  { repo: "acme/app", content_type: "spec" },
  { repo: "other/secret", content_type: "adr" },
];

function chunkTypeRows(sql: string, params: unknown[] = []) {
  const [first] = params;

  if (sql.includes("WHERE repo = $1")) {
    const named = String(first).toLowerCase();

    return CHUNK_TYPES_BY_REPO.filter((row) => row.repo === named);
  }

  return Array.isArray(first)
    ? CHUNK_TYPES_BY_REPO.filter((row) => first.includes(row.repo))
    : CHUNK_TYPES_BY_REPO;
}

const sha256 = (raw: string): string =>
  createHash("sha256").update(raw).digest("hex");

const TOKENS_BY_HASH: Record<string, unknown> = {
  [sha256(BEN_TOKEN)]: personToken("Ben", ["acme/app"], "ben"),
  [sha256(DANA_TOKEN)]: personToken("Dana", ["acme/app"], "dana"),
  [sha256(ALICE_TOKEN)]: personToken("Alice", ["acme/app"], "alice"),
};

function tokenRows(params: unknown[] | undefined): unknown[] {
  const row = TOKENS_BY_HASH[String(params?.[0])];

  return row ? [row] : [];
}

function personToken(
  displayName: string,
  repos: string[],
  login = displayName,
) {
  return {
    scopes: ["admin"],
    kind: "user",
    login,
    displayName,
    avatarUrl: null,
    repos,
    startedAt: new Date("2026-11-18T10:00:00Z"),
    expiresAt: null,
  };
}

const GUARDED_READ_ROUTES = [
  { path: "/api/context-evals/documents" },
  { path: "/api/chunk-types" },
  { path: "/api/repo-status" },
];

function readsGuardedData(sql: string): boolean {
  return sql.includes(".chunks") || sql.includes("FROM lore.repos");
}
