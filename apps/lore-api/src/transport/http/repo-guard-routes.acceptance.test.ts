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

describe("repository guard route level declarations (FR-002..FR-004, FR-166..FR-170)", () => {
  useRateLimitSafeClock();

  beforeEach(() => {
    process.env.LORE_INGEST_TOKEN = LEGACY_TOKEN;
    process.env.GITHUB_APP_ID = "999";
    process.env.GITHUB_APP_PRIVATE_KEY = APP_PRIVATE_KEY;
    process.env.GITHUB_APP_INSTALLATION_ID = "12345";
    delete process.env.GITHUB_TOKEN;
    delete process.env.UTOPIA_API_URL;
    delete process.env.LORE_WEBHOOK_URL;
    delete process.env.LORE_WEBHOOK_SECRET;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    globalThis.fetch = originalFetch;
  });

  it("refuses a person who cannot read the repository on read-only repository routes and admits a person with read", async () => {
    const { call, sqlCalls } = createLoreServer({
      "other/secret:ben": { status: 404 },
      "acme/app:ben": { status: 200, permission: "read" },
    });
    const denied: Record<string, number> = {};
    const allowed: Record<string, number> = {};

    for (const entry of READ_ROUTES) {
      const secretRes = await call("GET", entry.url("other/secret"), BEN_TOKEN);

      denied[entry.name] = secretRes.statusCode;
    }
    const guardedReadsWhenDenied = sqlCalls.filter(readsGuardedRepoData);

    for (const entry of READ_ROUTES) {
      const acmeRes = await call("GET", entry.url("acme/app"), BEN_TOKEN);

      allowed[entry.name] = acmeRes.statusCode;
    }

    expect({
      denied,
      guardedReadsWhenDenied,
      allowedNotForbidden: Object.values(allowed).every(
        (status) => status !== 403,
      ),
    }).toEqual({
      denied: Object.fromEntries(READ_ROUTES.map((entry) => [entry.name, 403])),
      guardedReadsWhenDenied: [],
      allowedNotForbidden: true,
    });
  });

  it("refuses a person with only read on routes that change a repository in Lore or on GitHub, and admits a person with write", async () => {
    const { call, sqlCalls, githubCalls } = createLoreServer({
      "acme/app:ben": { status: 200, permission: "read" },
      "acme/app:dana": { status: 200, permission: "write" },
    });
    const deniedStatuses: Record<string, number> = {};

    for (const entry of WRITE_ROUTES) {
      const res = await call(entry.method, entry.url, BEN_TOKEN, entry.payload);

      deniedStatuses[entry.name] = res.statusCode;
    }
    const dataWritesOnDenial = sqlCalls.filter(isDataWrite);
    const githubWritesOnDenial = githubCalls.filter(isGithubRepoWrite);

    const allowedWithWrite: Record<string, boolean> = {};

    for (const entry of WRITE_ALLOWED_CHECKS) {
      const res = await call(
        entry.method,
        entry.url,
        DANA_TOKEN,
        entry.payload,
      );

      allowedWithWrite[entry.name] = res.statusCode !== 403;
    }

    expect({
      deniedStatuses,
      dataWritesOnDenial,
      githubWritesOnDenial,
      allowedWithWrite,
    }).toEqual({
      deniedStatuses: Object.fromEntries(
        WRITE_ROUTES.map((entry) => [entry.name, 403]),
      ),
      dataWritesOnDenial: [],
      githubWritesOnDenial: [],
      allowedWithWrite: Object.fromEntries(
        WRITE_ALLOWED_CHECKS.map((entry) => [entry.name, true]),
      ),
    });
  });

  it("refuses a person below admin on POST /api/onboard for both first onboarding and re-onboarding, and admits admin", async () => {
    const { call, sqlCalls } = createLoreServer({
      "acme/app:dana": { status: 200, permission: "write" },
      "acme/app:alice": { status: 200, permission: "admin" },
    });
    const firstDenied = await call("POST", "/api/onboard", DANA_TOKEN, {
      repo: "acme/app",
    });
    const reonboardDenied = await call("POST", "/api/onboard", DANA_TOKEN, {
      repo: "acme/app",
      reonboard: true,
    });
    const repoReadsOnDenial = sqlCalls.filter(touchesRepoTables);

    const firstAllowed = await call("POST", "/api/onboard", ALICE_TOKEN, {
      repo: "acme/app",
    });
    const reonboardAllowed = await call("POST", "/api/onboard", ALICE_TOKEN, {
      repo: "acme/app",
      reonboard: true,
    });

    expect({
      firstDenied: [firstDenied.statusCode, firstDenied.result],
      reonboardDenied: [reonboardDenied.statusCode, reonboardDenied.result],
      repoReadsOnDenial,
      firstPassedGuard: firstAllowed.statusCode !== 403,
      reonboardPassedGuard: reonboardAllowed.statusCode !== 403,
    }).toEqual({
      firstDenied: [403, { error: "repository not allowed" }],
      reonboardDenied: [403, { error: "repository not allowed" }],
      repoReadsOnDenial: [],
      firstPassedGuard: true,
      reonboardPassedGuard: true,
    });
  });

  it("refuses a person below admin on repo settings, webhook ensure, and utopia setup, backfill, and reset, and admits admin", async () => {
    expect(await adminLevelOutcomes(ADMIN_ROUTES)).toEqual(
      adminLevelExpected(ADMIN_ROUTES),
    );
  });

  it("refuses a person below admin on utopia commits, memory, releases and tracker, loop switch and resume, and agent definition create and update, and admits admin", async () => {
    expect(await adminLevelOutcomes(ADMIN_ROUTES_PART_4)).toEqual(
      adminLevelExpected(ADMIN_ROUTES_PART_4),
    );
  });

  it("refuses a person below admin on agent definition delete, and admits admin", async () => {
    expect(await adminLevelOutcomes(ADMIN_ROUTES_PART_5)).toEqual(
      adminLevelExpected(ADMIN_ROUTES_PART_5),
    );
  });

  it("asks GitHub again on every admin request, refusing a person whose level fell since the last one", async () => {
    const permissions: Record<string, PermissionReply> = {
      "acme/app:alice": { status: 200, permission: "admin" },
    };
    const { call, githubCalls } = createLoreServer(permissions);
    const url = "/api/repos/acme/app/agent-definitions/reviewer";
    const first = await call("DELETE", url, ALICE_TOKEN);

    permissions["acme/app:alice"] = { status: 200, permission: "read" };
    const second = await call("DELETE", url, ALICE_TOKEN);

    expect({
      firstRefused: first.statusCode === 403,
      secondStatus: second.statusCode,
      permissionLookups: githubCalls.filter((entry) =>
        entry.path.endsWith("/collaborators/alice/permission"),
      ).length,
    }).toEqual({
      firstRefused: false,
      secondStatus: 403,
      permissionLookups: 2,
    });
  });

  it("answers an admin 404 and no secret on GET webhook/secret, which no longer exists", async () => {
    process.env.LORE_WEBHOOK_SECRET = "s3cr3t-signing-value";
    const { call } = createLoreServer({
      "acme/app:alice": { status: 200, permission: "admin" },
    });
    const res = await call(
      "GET",
      "/api/repos/acme/app/webhook/secret",
      ALICE_TOKEN,
    );

    expect({
      status: res.statusCode,
      leaksSecret: res.payload.includes("s3cr3t-signing-value"),
    }).toEqual({ status: 404, leaksSecret: false });
  });

  it("refuses a person with write on their own repository who posts an action on a task of another repository, and writes nothing", async () => {
    const { call, sqlCalls } = createLoreServer(
      {
        "acme/app:dana": { status: 200, permission: "write" },
        "other/secret:dana": { status: 404 },
      },
      [
        {
          match: (sql) => sql.includes("FROM pipeline.tasks"),
          rows: () => [
            { id: "t-secret", target_repo: "other/secret", status: "queued" },
          ],
        },
      ],
    );
    const res = await call("POST", "/api/task", DANA_TOKEN, {
      task_id: "t-secret",
      action: "cancel",
    });

    expect({
      status: res.statusCode,
      dataWrites: sqlCalls.filter(isDataWrite),
    }).toEqual({ status: 403, dataWrites: [] });
  });

  it("leaves a task post that names no task to the handler and writes nothing", async () => {
    const { call, sqlCalls, githubCalls } = createLoreServer({
      "acme/app:dana": { status: 200, permission: "write" },
    });
    const res = await call("POST", "/api/task", DANA_TOKEN, {
      action: "cancel",
    });

    expect({
      status: res.statusCode,
      githubCalls,
      dataWrites: sqlCalls.filter(isDataWrite),
    }).toEqual({ status: 400, githubCalls: [], dataWrites: [] });
  });

  it("leaves a task post that names an unknown task to the handler and writes nothing", async () => {
    const { call, sqlCalls } = createLoreServer(
      { "acme/app:dana": { status: 200, permission: "write" } },
      [
        {
          match: (sql) => sql.includes("FROM pipeline.tasks"),
          rows: () => [],
        },
      ],
    );
    const res = await call("POST", "/api/task", DANA_TOKEN, {
      task_id: "t-missing",
      action: "cancel",
    });

    expect({
      guardRefused: res.statusCode === 403,
      dataWrites: sqlCalls.filter(isDataWrite),
    }).toEqual({ guardRefused: false, dataWrites: [] });
  });

  it("refuses a person with write on their own repository who cancels a run of another repository, and changes nothing", async () => {
    const { call, sqlCalls, githubCalls } = createLoreServer(
      {
        "acme/app:dana": { status: 200, permission: "write" },
        "other/secret:dana": { status: 404 },
      },
      [
        {
          match: (sql) =>
            sql.includes("SELECT repo FROM pipeline.assembly_runs"),
          rows: () => [{ repo: "other/secret" }],
        },
      ],
    );
    const res = await call(
      "POST",
      "/api/assembly-runs/run-secret/cancel",
      DANA_TOKEN,
      {},
    );

    expect({
      status: res.statusCode,
      dataWrites: sqlCalls.filter(isDataWrite),
      floorOrGithubWrites: githubCalls.filter(
        (entry) => entry.method !== "GET" && !entry.path.includes("/app/"),
      ),
    }).toEqual({ status: 403, dataWrites: [], floorOrGithubWrites: [] });
  });

  it("refuses a caller with no credential or a made-up one on onboard and the admin repository routes, and writes nothing", async () => {
    const { server, sqlCalls, githubCalls } = createLoreServer({
      "acme/app:alice": { status: 200, permission: "admin" },
    });
    const probes: RouteProbe[] = [
      {
        name: "onboard",
        method: "POST",
        url: "/api/onboard",
        payload: { repo: "acme/app" },
      },
      ...ADMIN_ROUTES,
    ];
    const statuses: Record<string, [number, number]> = {};

    for (const entry of probes) {
      const anonymous = await server.inject({
        method: entry.method,
        url: entry.url,
        payload: entry.payload,
      });
      const madeUp = await server.inject({
        method: entry.method,
        url: entry.url,
        payload: entry.payload,
        headers: { authorization: "Bearer not-a-real-session" },
      });

      statuses[entry.name] = [anonymous.statusCode, madeUp.statusCode];
    }

    expect({
      statuses,
      dataWrites: sqlCalls.filter(isDataWrite),
      githubWrites: githubCalls.filter(isGithubRepoWrite),
    }).toEqual({
      statuses: Object.fromEntries(
        probes.map((entry) => [entry.name, [401, 401]]),
      ),
      dataWrites: [],
      githubWrites: [],
    });
  });

  it("refuses an admin of one repository who onboards a repository name that climbs out of owner/name, and writes nothing", async () => {
    const { call, sqlCalls, githubCalls } = createLoreServer({
      "acme/app:alice": { status: 200, permission: "admin" },
    });
    const climbs = [
      "other/secret/../../acme/app",
      "acme/app/../../other/secret",
    ];
    const statuses: number[] = [];

    for (const repo of climbs) {
      statuses.push(
        (await call("POST", "/api/onboard", ALICE_TOKEN, { repo })).statusCode,
      );
    }

    expect({
      statuses,
      repoTouches: sqlCalls.filter(touchesRepoTables),
      githubWrites: githubCalls.filter(isGithubRepoWrite),
    }).toEqual({
      statuses: [403, 403],
      repoTouches: [],
      githubWrites: [],
    });
  });
});

async function adminLevelOutcomes(routes: RouteProbe[]) {
  const { call, sqlCalls, githubCalls } = createLoreServer({
    "acme/app:dana": { status: 200, permission: "write" },
    "acme/app:alice": { status: 200, permission: "admin" },
  });
  const denied: Record<string, number> = {};
  const allowed: Record<string, boolean> = {};

  for (const entry of routes) {
    const res = await call(entry.method, entry.url, DANA_TOKEN, entry.payload);

    denied[entry.name] = res.statusCode;
  }
  const repoTouchesOnDenial = sqlCalls.filter(touchesRepoTables);
  const githubWritesOnDenial = githubCalls.filter(isGithubRepoWrite);
  const dataWritesOnDenial = sqlCalls.filter(isDataWrite);

  for (const entry of routes) {
    const res = await call(entry.method, entry.url, ALICE_TOKEN, entry.payload);

    allowed[entry.name] = res.statusCode !== 403;
  }

  return {
    denied,
    repoTouchesOnDenial,
    githubWritesOnDenial,
    dataWritesOnDenial,
    allowed,
  };
}

function adminLevelExpected(routes: RouteProbe[]) {
  return {
    denied: Object.fromEntries(routes.map((entry) => [entry.name, 403])),
    repoTouchesOnDenial: [],
    githubWritesOnDenial: [],
    dataWritesOnDenial: [],
    allowed: Object.fromEntries(routes.map((entry) => [entry.name, true])),
  };
}

interface RouteProbe {
  name: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  url: string;
  payload?: object;
}

const READ_ROUTES: Array<{ name: string; url: (repo: string) => string }> = [
  {
    name: "pr-status",
    url: (repo) => `/api/pr-status?repo=${repo}&pr_number=1`,
  },
  {
    name: "chunks-by-path",
    url: (repo) => `/api/chunks/by-path?repo=${repo}&path=README.md`,
  },
  { name: "graph", url: (repo) => `/api/graph?repo=${repo}` },
  { name: "events", url: (repo) => `/api/events?repo=${repo}` },
  { name: "floor-runs", url: (repo) => `/api/floor-runs?repo=${repo}` },
  { name: "assembly-runs", url: (repo) => `/api/assembly-runs?repo=${repo}` },
  {
    name: "blocked-pulls",
    url: (repo) => `/api/repos/${repo}/blocked-pulls`,
  },
];

const WRITE_ROUTES: RouteProbe[] = [
  {
    name: "chunks-prune",
    method: "POST",
    url: "/api/repos/acme/app/chunks/prune",
    payload: { present_paths: ["README.md"] },
  },
  {
    name: "ingest-delta",
    method: "POST",
    url: "/api/repos/acme/app/ingest",
    payload: { kind: "docs", commit: "abcdef1", base_commit: null, files: [] },
  },
  {
    name: "trace-overlay-drop",
    method: "POST",
    url: "/api/repos/acme/app/trace/overlay-drop",
    payload: { branch: "feat" },
  },
  {
    name: "station-tasks",
    method: "POST",
    url: "/api/repos/acme/app/tasks",
    payload: { description: "Work", taskType: "chore" },
  },
  {
    name: "issues-create",
    method: "POST",
    url: "/api/repos/acme/app/issues",
    payload: { title: "Bug", body: "Broken" },
  },
  {
    name: "branches-create",
    method: "POST",
    url: "/api/repos/acme/app/branches",
    payload: { branch: "feat/x" },
  },
  {
    name: "commit-create",
    method: "POST",
    url: "/api/repos/acme/app/commit",
    payload: {
      branch: "feat/x",
      path: "a.txt",
      content: "hi",
      message: "msg",
    },
  },
  {
    name: "pulls-create",
    method: "POST",
    url: "/api/repos/acme/app/pulls",
    payload: { branch: "feat/x", title: "PR", body: "desc" },
  },
  {
    name: "issue-update",
    method: "PATCH",
    url: "/api/repos/acme/app/issues/1",
    payload: { title: "Updated" },
  },
  {
    name: "sub-issue-add",
    method: "POST",
    url: "/api/repos/acme/app/issues/1/sub-issues",
    payload: { child: 2 },
  },
  {
    name: "release-now",
    method: "POST",
    url: "/api/repos/acme/app/release",
  },
  {
    name: "plan-delete",
    method: "DELETE",
    url: "/api/repos/acme/app/plans/plan-1",
  },
  {
    name: "plan-approve",
    method: "POST",
    url: "/api/repos/acme/app/plans/plan-1/approve",
    payload: { approvedBy: "ben" },
  },
  {
    name: "plan-reopen",
    method: "POST",
    url: "/api/repos/acme/app/plans/plan-1/reopen",
    payload: { reopenedBy: "ben" },
  },
  {
    name: "plan-spec-work",
    method: "POST",
    url: "/api/repos/acme/app/plans/plan-1/spec-work",
    payload: { createdBy: "ben" },
  },
  {
    name: "changelog-intro",
    method: "POST",
    url: "/api/repos/acme/app/changelog/2024-W01/intro",
  },
  {
    name: "review-start",
    method: "POST",
    url: "/api/review/start",
    payload: { repo: "acme/app", pr_number: 1 },
  },
  {
    name: "task-post",
    method: "POST",
    url: "/api/task",
    payload: { task_id: "t-acme", action: "cancel" },
  },
  {
    name: "run-cancel",
    method: "POST",
    url: "/api/assembly-runs/run-acme/cancel",
    payload: {},
  },
];

const WRITE_ALLOWED_CHECKS: RouteProbe[] = [
  {
    name: "chunks-prune",
    method: "POST",
    url: "/api/repos/acme/app/chunks/prune",
    payload: { present_paths: ["README.md"] },
  },
  {
    name: "trace-overlay-drop",
    method: "POST",
    url: "/api/repos/acme/app/trace/overlay-drop",
    payload: { branch: "feat" },
  },
  {
    name: "plan-delete",
    method: "DELETE",
    url: "/api/repos/acme/app/plans/plan-1",
  },
  {
    name: "changelog-intro",
    method: "POST",
    url: "/api/repos/acme/app/changelog/2024-W01/intro",
  },
  {
    name: "task-post",
    method: "POST",
    url: "/api/task",
    payload: { task_id: "t-acme", action: "cancel" },
  },
];

const ADMIN_ROUTES: RouteProbe[] = [
  {
    name: "repo-settings",
    method: "PUT",
    url: "/api/repos/acme/app/settings",
    payload: { settings: { auto_merge: { enabled: true, min_age_hours: 0 } } },
  },
  {
    name: "webhook-ensure",
    method: "POST",
    url: "/api/repos/acme/app/webhook/ensure",
  },
  {
    name: "utopia-setup",
    method: "POST",
    url: "/api/repos/acme/app/utopia/setup",
    payload: { session_token: "utopia-jwt", workspace_id: "ws-1" },
  },
  {
    name: "utopia-backfill",
    method: "POST",
    url: "/api/repos/acme/app/utopia/backfill",
  },
  {
    name: "utopia-reset",
    method: "POST",
    url: "/api/repos/acme/app/utopia/reset",
  },
];

const ADMIN_ROUTES_PART_4: RouteProbe[] = [
  {
    name: "utopia-commits",
    method: "POST",
    url: "/api/repos/acme/app/utopia/commits",
  },
  {
    name: "utopia-memory",
    method: "POST",
    url: "/api/repos/acme/app/utopia/memory",
  },
  {
    name: "utopia-releases",
    method: "POST",
    url: "/api/repos/acme/app/utopia/releases",
  },
  {
    name: "utopia-tracker",
    method: "POST",
    url: "/api/repos/acme/app/utopia/tracker",
  },
  {
    name: "loop-switch",
    method: "PUT",
    url: "/api/repos/acme/app/loops/review",
    payload: { enabled: true },
  },
  {
    name: "loop-resume",
    method: "DELETE",
    url: "/api/repos/acme/app/loops/review/pause",
  },
  {
    name: "agent-definition-create",
    method: "POST",
    url: "/api/repos/acme/app/agent-definitions",
    payload: { name: "reviewer", prompt: "Review it" },
  },
  {
    name: "agent-definition-update",
    method: "PUT",
    url: "/api/repos/acme/app/agent-definitions/reviewer",
    payload: { prompt: "Review it again" },
  },
];

const ADMIN_ROUTES_PART_5: RouteProbe[] = [
  {
    name: "agent-definition-delete",
    method: "DELETE",
    url: "/api/repos/acme/app/agent-definitions/reviewer",
  },
];

interface PermissionReply {
  status: number;
  permission?: "admin" | "write" | "read" | "none";
}

interface RecordedGithubCall {
  method: string;
  path: string;
  authorization: string;
}

function createLoreServer(
  permissions: Record<string, PermissionReply>,
  firstHandlers: typeof QUERY_HANDLERS = [],
) {
  const pool = makePool();
  const sqlCalls: string[] = [];
  const githubCalls: RecordedGithubCall[] = [];

  globalThis.fetch = createGithubFetchStub(permissions, githubCalls);
  pool.query.mockImplementation((rawSql: string, params?: unknown[]) => {
    const sql = String(rawSql);

    sqlCalls.push(sql);

    const first = firstHandlers.find((entry) => entry.match(sql));

    return Promise.resolve({
      rows: first ? first.rows(sql, params) : queryRowsFor(sql, params),
    });
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
      method: RouteProbe["method"],
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

function readsGuardedRepoData(sql: string): boolean {
  return (
    sql.includes(".chunks") ||
    sql.includes("FROM pipeline.events") ||
    sql.includes("FROM pipeline.assembly_runs") ||
    sql.includes("FROM graph.") ||
    sql.includes("FROM lore.repos")
  );
}

function touchesRepoTables(sql: string): boolean {
  return (
    sql.includes("lore.repos") ||
    sql.includes("pipeline.tasks") ||
    sql.includes("lore.plans")
  );
}

function isDataWrite(sql: string): boolean {
  return (
    /\b(INSERT|UPDATE|DELETE)\b/i.test(sql) &&
    !sql.includes("UPDATE pipeline.api_tokens")
  );
}

function isGithubRepoWrite(entry: RecordedGithubCall): boolean {
  return (
    entry.path.startsWith("/repos/") &&
    entry.method !== "GET" &&
    entry.method !== "HEAD"
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
    match: (sql) => sql.includes("public_mirror"),
    rows: () => [],
  },
  {
    match: (sql) => sql.includes("FROM lore.repos"),
    rows: (_sql, params) => repoRows(params),
  },
  {
    match: (sql) => sql.includes("SELECT repo FROM pipeline.assembly_runs"),
    rows: () => [{ repo: "acme/app" }],
  },
  {
    match: (sql) => sql.includes("FROM pipeline.tasks"),
    rows: () => [{ id: "t-acme", target_repo: "acme/app", status: "queued" }],
  },
  {
    match: (sql) => sql.includes("SELECT count(*)::int as count"),
    rows: () => [{ count: 0 }],
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
      settings: {},
      outcome_stats: null,
    },
  ];
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
    github_id: 1000 + displayName.length,
    login,
    displayName,
    avatarUrl: null,
    repos,
    startedAt: new Date("2026-11-18T10:00:00Z"),
    expiresAt: null,
  };
}
