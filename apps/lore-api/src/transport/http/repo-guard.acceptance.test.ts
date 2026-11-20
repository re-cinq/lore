import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  LEGACY_TOKEN,
  makePool,
  useRateLimitSafeClock,
} from "@re-cinq/lore-server-core/test-helpers/http-mock.js";
import { buildServer } from "../../app/build-server.js";
import { repoDeclarationOf, repoLevel } from "./repo-guard.js";

const originalEnv = { ...process.env };
const BEN_TOKEN = "ben-session";
const NORA_TOKEN = "nora-session";
const READ_SERVICE_TOKEN = "read-only-service";

describe("repository level declarations and guard", () => {
  useRateLimitSafeClock();

  beforeEach(() => {
    process.env.LORE_INGEST_TOKEN = LEGACY_TOKEN;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("refuses a person a repository named in a payload, a query, or a record with 403 before the handler runs", async () => {
    const { call, sqlCalls } = createLoreServer();
    const pathDenied = await call(
      "GET",
      "/api/repos/other/secret/chunk-summary",
      BEN_TOKEN,
    );
    const queryDenied = await call(
      "GET",
      "/api/repo-tasks?repo=other/secret",
      BEN_TOKEN,
    );
    const payloadDenied = await call("POST", "/api/ingest", BEN_TOKEN, {
      repo: "other/secret",
      files: [],
    });
    const recordDenied = await call(
      "GET",
      "/api/tasks/t-secret/runtime",
      BEN_TOKEN,
    );
    const statuses = [
      pathDenied.statusCode,
      queryDenied.statusCode,
      payloadDenied.statusCode,
      recordDenied.statusCode,
    ];
    const handlerReached = sqlCalls.some(isBlockedHandlerQuery);
    const payloadAllowed = await call("POST", "/api/ingest", BEN_TOKEN, {
      repo: "acme/app",
      files: [],
    });
    const recordAllowed = await call(
      "GET",
      "/api/tasks/t-acme/runtime",
      BEN_TOKEN,
    );

    expect({
      statuses,
      handlerReached,
      allowed: [payloadAllowed.statusCode, recordAllowed.statusCode],
    }).toEqual({
      statuses: [403, 403, 403, 403],
      handlerReached: false,
      allowed: [200, 200],
    });
  });

  it("returns a person only rows of repositories they can read on routes that span repositories", async () => {
    const { call } = createLoreServer();
    const personRepos = await call("GET", "/api/repos", BEN_TOKEN);
    const personInbox = await call("GET", "/api/inbox", BEN_TOKEN);
    const serviceRepos = await call("GET", "/api/repos", LEGACY_TOKEN);

    const personRepoNames = (
      personRepos.result as { repos: Array<{ full_name: string }> }
    ).repos.map((row) => row.full_name);
    const personInboxRepos = (
      personInbox.result as { items: Array<{ repo: string }> }
    ).items.map((inboxEntry) => inboxEntry.repo);
    const serviceRepoNames = (
      serviceRepos.result as { repos: Array<{ full_name: string }> }
    ).repos.map((row) => row.full_name);

    expect({
      personRepos: [personRepos.statusCode, personRepoNames],
      personInbox: [personInbox.statusCode, personInboxRepos],
      serviceRepos: [serviceRepos.statusCode, serviceRepoNames],
    }).toEqual({
      personRepos: [200, ["acme/app"]],
      personInbox: [200, ["acme/app", "acme/app"]],
      serviceRepos: [200, ["acme/app", "other/secret"]],
    });
  });

  it("counts 1 repository in the repo list total for a person who can read one, and 2 for a service token", async () => {
    const { call } = createLoreServer();
    const person = await call("GET", "/api/repos", BEN_TOKEN);
    const service = await call("GET", "/api/repos", LEGACY_TOKEN);

    expect({
      person: (person.result as { total: number }).total,
      service: (service.result as { total: number }).total,
    }).toEqual({ person: 1, service: 2 });
  });

  it("leaves the runtime of a task that does not exist to its handler, which answers 200 instead of refusing the person", async () => {
    const { call } = createLoreServer();
    const res = await call("GET", "/api/tasks/t-missing/runtime", BEN_TOKEN);

    expect(res.statusCode).toEqual(200);
  });

  it("returns a person only chunks of repositories they can read when GET /api/chunks names no repo", async () => {
    const { call } = createLoreServer();
    const personChunks = await call("GET", "/api/chunks", BEN_TOKEN);
    const serviceChunks = await call("GET", "/api/chunks", LEGACY_TOKEN);

    const personRepos = (
      personChunks.result as { chunks: Array<{ repo: string | null }> }
    ).chunks.map((chunk) => chunk.repo);
    const serviceRepos = (
      serviceChunks.result as { chunks: Array<{ repo: string | null }> }
    ).chunks.map((chunk) => chunk.repo);

    expect({
      person: [personChunks.statusCode, personRepos],
      service: [serviceChunks.statusCode, serviceRepos],
    }).toEqual({
      person: [200, ["acme/app"]],
      service: [200, ["acme/app", "other/secret"]],
    });
  });

  it("refuses GET /api/chunks?repo= with 403 for a person who cannot read that repository", async () => {
    const { call, sqlCalls } = createLoreServer();
    const denied = await call(
      "GET",
      "/api/chunks?repo=other/secret",
      BEN_TOKEN,
    );
    const queriedChunksOnDenial = sqlCalls.some((sql) =>
      sql.includes(".chunks"),
    );
    const allowed = await call("GET", "/api/chunks?repo=acme/app", BEN_TOKEN);

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

  it("refuses GET /api/context?repo= with 403 for a person who cannot read that repository", async () => {
    const { call, sqlCalls } = createLoreServer();
    const denied = await call(
      "GET",
      "/api/context?repo=other/secret",
      BEN_TOKEN,
    );
    const queriedChunksOnDenial = sqlCalls.some((sql) =>
      sql.includes(".chunks"),
    );
    const allowed = await call("GET", "/api/context?repo=acme/app", BEN_TOKEN);

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

  it("refuses POST /api/context with 403 when its body names a repository the person cannot read", async () => {
    const { call, sqlCalls } = createLoreServer();
    const denied = await call("POST", "/api/context", BEN_TOKEN, {
      repo: "other/secret",
    });
    const queriedChunksOnDenial = sqlCalls.some((sql) =>
      sql.includes(".chunks"),
    );

    expect({
      deniedStatus: denied.statusCode,
      queriedChunksOnDenial,
    }).toEqual({ deniedStatus: 403, queriedChunksOnDenial: false });
  });

  it("refuses a caller with no token or a made-up token with 401 on repository and spanning routes", async () => {
    const { call, server } = createLoreServer();
    const madeUp = await Promise.all(
      ["/api/chunks?repo=acme/app", "/api/inbox", "/api/repos"].map((url) =>
        call("GET", url, "not-a-real-token"),
      ),
    );
    const anonymous = await server.inject({
      method: "GET",
      url: "/api/chunks?repo=acme/app",
    });

    expect({
      madeUp: madeUp.map((res) => res.statusCode),
      anonymous: anonymous.statusCode,
    }).toEqual({ madeUp: [401, 401, 401], anonymous: 401 });
  });

  it("refuses a repository named in another letter case than the person's list allows", async () => {
    const { call, sqlCalls } = createLoreServer();
    const denied = await call(
      "GET",
      "/api/repo-tasks?repo=OTHER/Secret",
      BEN_TOKEN,
    );

    expect({
      status: denied.statusCode,
      handlerReached: sqlCalls.some(isBlockedHandlerQuery),
    }).toEqual({ status: 403, handlerReached: false });
  });

  it("refuses a record route when looking up the record's repository fails, never reaching the handler", async () => {
    const { call, sqlCalls } = createLoreServer((sql) =>
      sql.includes("SELECT target_repo FROM pipeline.tasks"),
    );
    const res = await call("GET", "/api/tasks/t-secret/runtime", BEN_TOKEN);

    expect({
      refused: res.statusCode >= 500,
      handlerReached: sqlCalls.some(isBlockedHandlerQuery),
    }).toEqual({ refused: true, handlerReached: false });
  });

  it("refuses GET /api/chunks when the repo parameter is repeated to slip a second repository past the guard", async () => {
    const { call, sqlCalls } = createLoreServer();
    const res = await call(
      "GET",
      "/api/chunks?repo=acme/app&repo=other/secret",
      BEN_TOKEN,
    );

    expect({
      allowed: res.statusCode === 200,
      queriedChunks: sqlCalls.some((sql) => sql.includes(".chunks")),
    }).toEqual({ allowed: false, queriedChunks: false });
  });

  it("returns a person whose sign-in list is empty no rows on routes that span repositories", async () => {
    const { call } = createLoreServer();
    const repos = await call("GET", "/api/repos", NORA_TOKEN);
    const inbox = await call("GET", "/api/inbox", NORA_TOKEN);
    const chunks = await call("GET", "/api/chunks", NORA_TOKEN);

    expect({
      repos: [
        repos.statusCode,
        (repos.result as { repos: unknown[] }).repos.length,
      ],
      inbox: [
        inbox.statusCode,
        (inbox.result as { items: unknown[] }).items.length,
      ],
      chunks: [
        chunks.statusCode,
        (chunks.result as { chunks: unknown[] }).chunks.length,
      ],
    }).toEqual({ repos: [200, 0], inbox: [200, 0], chunks: [200, 0] });
  });

  it("refuses POST /api/ingest for a repository the person cannot read and writes nothing", async () => {
    const { call, sqlCalls } = createLoreServer();
    const denied = await call("POST", "/api/ingest", BEN_TOKEN, {
      repo: "other/secret",
      files: [{ path: "README.md", content: "planted" }],
    });

    expect({
      status: denied.statusCode,
      writes: sqlCalls.filter(isDataWrite),
    }).toEqual({ status: 403, writes: [] });
  });

  it("refuses a repository that is malformed, the wrong type, or climbs out of owner/name before any chunk or write", async () => {
    const { call, sqlCalls } = createLoreServer();
    const climbing = await call(
      "GET",
      "/api/chunks?repo=acme/app/../../other/secret",
      BEN_TOKEN,
    );
    const contextWrongType = await call("POST", "/api/context", BEN_TOKEN, {
      repo: ["other/secret"],
      query: "secrets",
    });
    const ingestWrongType = await call("POST", "/api/ingest", BEN_TOKEN, {
      repo: { full_name: "other/secret" },
      files: [{ path: "README.md", content: "planted" }],
    });

    expect({
      refused: [climbing, contextWrongType, ingestWrongType].map(
        (res) => res.statusCode === 400 || res.statusCode === 403,
      ),
      queriedChunks: sqlCalls.some((sql) => sql.includes(".chunks")),
      writes: sqlCalls.filter(isDataWrite),
    }).toEqual({
      refused: [true, true, true],
      queriedChunks: false,
      writes: [],
    });
  });

  it("declares each repository route's level and source beside bearerScope without weakening bearer scope checks", async () => {
    const { server, call } = createLoreServer();
    const declarations = new Map(
      server.table().map((route) => {
        const decl = repoDeclarationOf({ route });

        return [
          `${route.method.toUpperCase()} ${route.path}`,
          decl ? `${decl.level}:${decl.source.from}` : null,
        ];
      }),
    );
    const readServiceIngest = await call(
      "POST",
      "/api/ingest",
      READ_SERVICE_TOKEN,
      { repo: "acme/app", files: [] },
    );
    const pathDefault = repoDeclarationOf({
      route: { settings: repoLevel("admin") },
    });

    expect({
      pathDefault,
      chunks: declarations.get("GET /api/chunks"),
      contextGet: declarations.get("GET /api/context"),
      contextPost: declarations.get("POST /api/context"),
      ingest: declarations.get("POST /api/ingest"),
      repoTasks: declarations.get("GET /api/repo-tasks"),
      taskRuntime: declarations.get("GET /api/tasks/{id}/runtime"),
      repos: declarations.get("GET /api/repos"),
      inbox: declarations.get("GET /api/inbox"),
      readServiceIngest: readServiceIngest.statusCode,
    }).toEqual({
      pathDefault: { level: "admin", source: { from: "path" } },
      chunks: "read:query",
      contextGet: "read:query",
      contextPost: "read:payload",
      ingest: "write:payload",
      repoTasks: "read:query",
      taskRuntime: "read:record",
      repos: "read:spans",
      inbox: "read:spans",
      readServiceIngest: 403,
    });
  });
});

function isDataWrite(sql: string): boolean {
  return (
    /\b(INSERT|UPDATE|DELETE)\b/i.test(sql) &&
    !sql.includes("UPDATE pipeline.api_tokens")
  );
}

function isBlockedHandlerQuery(sql: string): boolean {
  return (
    sql.includes("pipeline.task_events") ||
    sql.includes("pipeline.llm_calls") ||
    sql.includes("WHERE target_repo = $1") ||
    sql.includes("SELECT team FROM lore.repos WHERE full_name")
  );
}

function createLoreServer(failsOn: (sql: string) => boolean = () => false) {
  const pool = makePool();
  const sqlCalls: string[] = [];

  pool.query.mockImplementation((rawSql: string, params?: unknown[]) => {
    const sql = String(rawSql);

    sqlCalls.push(sql);

    if (failsOn(sql)) {
      return Promise.reject(new Error("database unavailable"));
    }

    return Promise.resolve({ rows: queryRowsFor(sql, params) });
  });

  const server = buildServer(() => pool as never);

  return {
    sqlCalls,
    server,
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

const QUERY_HANDLERS: Array<{
  match: (sql: string) => boolean;
  rows: (sql: string, params: unknown[] | undefined) => unknown[];
}> = [
  {
    match: (sql) => sql.includes("UPDATE pipeline.api_tokens"),
    rows: (_sql, params) => tokenRows(params),
  },
  {
    match: (sql) => sql.includes("SELECT DISTINCT team FROM lore.repos"),
    rows: () => [{ team: "platform" }],
  },
  {
    match: (sql) => sql.includes("information_schema.tables"),
    rows: () => [{ table_schema: "platform" }],
  },
  {
    match: (sql) => sql.includes("SELECT team FROM lore.repos WHERE full_name"),
    rows: () => [{ team: "platform" }],
  },
  {
    match: (sql) => sql.includes("count(*)::int as total FROM lore.repos"),
    rows: (_sql, params) => [{ total: repoRows(params).length }],
  },
  {
    match: (sql) => sql.includes("FROM lore.repos"),
    rows: (_sql, params) => repoRows(params),
  },
  {
    match: (sql) => sql.includes("FROM lore.plans"),
    rows: (_sql, params) => planRows(params),
  },
  {
    match: (sql) => sql.includes(".chunks"),
    rows: (sql, params) => chunkRows(sql, params),
  },
  {
    match: (sql) => sql.includes("pipeline.tasks"),
    rows: (_sql, params) => taskRows(params),
  },
];

function queryRowsFor(sql: string, params: unknown[] | undefined): unknown[] {
  const matched = QUERY_HANDLERS.find((entry) => entry.match(sql));

  return matched ? matched.rows(sql, params) : [];
}

const sha256 = (raw: string): string =>
  createHash("sha256").update(raw).digest("hex");

const TOKENS_BY_HASH: Record<string, unknown> = {
  [sha256(BEN_TOKEN)]: personToken("Ben", ["acme/app"], "ben"),
  [sha256(NORA_TOKEN)]: personToken("nora", []),
  [sha256(READ_SERVICE_TOKEN)]: serviceToken(["read"]),
};

function tokenRows(params: unknown[] | undefined): unknown[] {
  const row = TOKENS_BY_HASH[String(params?.[0])];

  return row ? [row] : [];
}

function repoRows(params: unknown[] | undefined) {
  const allowed = repoFilterOf(params);
  const all = [
    {
      id: "r-acme",
      owner: "acme",
      name: "app",
      full_name: "acme/app",
      team: "platform",
      onboarded_at: new Date("2026-11-18T00:00:00Z"),
      last_ingested_at: null,
      onboarding_pr_url: "https://github.com/acme/app/pull/1",
      onboarding_pr_merged: false,
      settings: {},
      outcome_stats: null,
      task_count: 0,
      active_agents: 0,
    },
    {
      id: "r-secret",
      owner: "other",
      name: "secret",
      full_name: "other/secret",
      team: "platform",
      onboarded_at: new Date("2026-11-18T00:00:00Z"),
      last_ingested_at: null,
      onboarding_pr_url: "https://github.com/other/secret/pull/2",
      onboarding_pr_merged: false,
      settings: {},
      outcome_stats: null,
      task_count: 0,
      active_agents: 0,
    },
  ];

  return allowed
    ? all.filter((row) => allowed.has(row.full_name.toLowerCase()))
    : all;
}

function planRows(params: unknown[] | undefined) {
  const allowed = repoFilterOf(params);
  const all = [
    {
      id: "p-acme",
      repo: "acme/app",
      title: "Acme plan",
      status: "in-review",
      updated_at: new Date("2026-11-18T00:00:00Z"),
    },
    {
      id: "p-secret",
      repo: "other/secret",
      title: "Secret plan",
      status: "in-review",
      updated_at: new Date("2026-11-18T00:00:00Z"),
    },
  ];

  return allowed
    ? all.filter((row) => allowed.has(row.repo.toLowerCase()))
    : all;
}

function chunkRows(sql: string, params: unknown[] | undefined) {
  if (sql.includes("count(*)")) {
    return [{ count: 1 }];
  }

  if (sql.includes("SELECT DISTINCT file_path")) {
    return [{ file_path: "AGENTS.md" }];
  }

  if (sql.includes("WHERE repo = $1")) {
    return repoChunkRows(params);
  }

  return unionChunkRows(params);
}

function repoChunkRows(params: unknown[] | undefined) {
  const repo = typeof params?.[0] === "string" ? params[0] : "acme/app";

  return [chunkRow(`c-${repo}`, repo)];
}

function unionChunkRows(params: unknown[] | undefined) {
  const allowed = repoFilterOf(params);
  const all = [
    chunkRow("c-acme", "acme/app"),
    chunkRow("c-secret", "other/secret"),
  ];

  return allowed
    ? all.filter((row) => allowed.has(row.repo.toLowerCase()))
    : all;
}

function chunkRow(id: string, repo: string) {
  return {
    id,
    file_path: "README.md",
    content_type: "doc",
    repo,
    metadata: {},
    content: `context for ${repo}`,
    ingested_at: new Date("2026-11-18T00:00:00Z"),
    rank: 0,
  };
}

function taskRows(params: unknown[] | undefined) {
  const id = params?.[0];

  if (id === "t-secret") {
    return [{ id: "t-secret", target_repo: "other/secret", status: "pending" }];
  }

  if (id === "t-acme") {
    return [{ id: "t-acme", target_repo: "acme/app", status: "pending" }];
  }

  return [];
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

function serviceToken(scopes: string[]) {
  return {
    scopes,
    kind: "service",
    login: null,
    displayName: null,
    avatarUrl: null,
    repos: [],
    startedAt: null,
    expiresAt: null,
  };
}

function repoFilterOf(params: unknown[] | undefined): Set<string> | null {
  if (params?.some((entry) => Array.isArray(entry) && entry.length === 0)) {
    return new Set();
  }

  const list = params?.find(
    (entry): entry is string[] =>
      Array.isArray(entry) &&
      entry.length > 0 &&
      entry.every(
        (repoName) => typeof repoName === "string" && repoName.includes("/"),
      ),
  );

  return list ? new Set(list.map((name) => name.toLowerCase())) : null;
}
