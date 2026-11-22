import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { ServerRoute } from "@hapi/hapi";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  LEGACY_TOKEN,
  makePool,
} from "@re-cinq/lore-server-core/test-helpers/http-mock.js";
import { setPool } from "@re-cinq/lore-server-core/platform/db.js";
import { useMirrorOwner } from "@re-cinq/lore-shared/floor/floor-client.js";
import { buildServer } from "../../app/build-server.js";
import { getOctokit } from "../../outbound/github-client.js";
import { projectFor } from "../../outbound/project-boot.js";
import { bearerScope } from "./bearer-scope.js";
import { repoLevel } from "./repo-guard.js";

const API_URL = "https://lore-api.example.com";
const UI_URL = "https://lore-ui.example.com";
const FLOOR_URL = "https://floor.example.com";
const GITHUB_ORG = "acme";
const INSTALLATION_ID = "42";
const APP_TOKEN = "ghs_test_installation";
const USER_ACCESS_TOKEN = "ghu_person_access_enforcement";
const USER_REFRESH_TOKEN = "ghr_person_access_enforcement";
const ENCRYPTION_KEY = randomBytes(32).toString("base64");
const BASE_NOW_MS = new Date("2026-11-22T09:00:00.000Z").getTime();

const ORIGINAL_ENV = { ...process.env };
const ORIGINAL_FETCH = globalThis.fetch;

let nowMs = BASE_NOW_MS;

type RepoPermission = "admin" | "write" | "read" | "none";

interface RepoRecord {
  id: string;
  owner: string;
  name: string;
  fullName: string;
  onboardedAt: Date;
  settings: Record<string, unknown>;
}

interface RecordedGithubWrite {
  method: string;
  path: string;
  authorization: string;
}

interface HarnessConfig {
  installationRepos: string[];
  permissions?: Record<string, RepoPermission>;
}

describe("Person access enforcement: App-client guard, session scope irrelevance, and org-wide routes (FR-311, FR-035, FR-036)", () => {
  beforeEach(() => {
    nowMs += 600_000;
    vi.useFakeTimers({ now: nowMs, toFake: ["Date"] });
    configureEnv();
    useMirrorOwner(async () => null);
  });

  afterEach(() => {
    useMirrorOwner(null);
    vi.useRealTimers();
    setPool(null as never);
    globalThis.fetch = ORIGINAL_FETCH;
    process.env = { ...ORIGINAL_ENV };
  });

  it("blocks a handler serving a person's session from reaching getOctokit or the App-authenticated project for a GitHub write, while allowing person reads and service writes", async () => {
    const harness = createHarness({
      installationRepos: ["acme/app"],
      permissions: { "acme/app": "write" },
    });

    harness.repos.push(repoRow("acme/app"));
    harness.server.route(appClientProbeRoutes());
    const token = await signIn(harness.server);

    const personWriteOutcomes = await runPersonAppClientWrites(
      harness.server,
      token,
    );
    const personWrites = [...harness.githubWrites];
    const readRes = await harness.server.inject({
      method: "GET",
      url: "/api/repos/acme/app/_fr311/octokit-read",
      headers: { authorization: `Bearer ${token}` },
    });
    const serviceResults = await runServiceAppClientWrites(harness.server);

    expect({
      ...personWriteOutcomes,
      personAppWrites: personWrites,
      personReadStatus: readRes.statusCode,
      serviceStatuses: serviceResults,
      serviceActors: harness.githubWrites
        .slice(personWrites.length)
        .map((w) => actorOf(w.authorization)),
    }).toEqual({
      personOctokitWrite: "blocked",
      personProjectWrite: "blocked",
      personAppWrites: [],
      personReadStatus: 200,
      serviceStatuses: [200, 200],
      serviceActors: ["app", "app"],
    });
  });

  it("admits a person with only the read session scope on write and admin repository routes when GitHub grants write or admin, and refuses 403 with nothing written when GitHub grants read despite an admin session scope", async () => {
    const harness = createHarness({
      installationRepos: ["acme/app"],
      permissions: { "acme/app": "write" },
    });

    harness.repos.push(repoRow("acme/app"));
    const token = await signIn(harness.server);

    harness.setSessionScopes(token, ["read"]);
    const weakScopeOutcomes = await runWeakScopeRepoWrites(harness, token);

    harness.setSessionScopes(token, ["admin"]);
    harness.setPermissions({ "acme/app": "read" });
    const writesBeforeRefusal = harness.githubWrites.length;
    const readRefused = await harness.server.inject({
      method: "POST",
      url: "/api/repos/acme/app/branches",
      headers: { authorization: `Bearer ${token}` },
      payload: { branch: "feat/fr035-denied" },
    });

    expect({
      ...weakScopeOutcomes,
      refusedStatus: readRefused.statusCode,
      writesAfterRefusal: harness.githubWrites.slice(writesBeforeRefusal),
    }).toEqual({
      writeStatus: 200,
      writeActor: "person",
      adminStatus: 200,
      refusedStatus: 403,
      writesAfterRefusal: [],
    });
  });

  it("lets a signed-in member with an empty installation list reach the organisation-wide routes and refuses a non-member's session", async () => {
    const harness = createHarness({ installationRepos: [] });
    const token = await signIn(harness.server);

    const memberStatuses = await callOrgWideRoutes(harness.server, token);

    harness.revokeOrgMembership();
    advanceDateBy(5 * 60_000 + 1_000);
    const nonMemberStatuses = await callOrgWideRoutes(harness.server, token);

    expect({ memberStatuses, nonMemberStatuses }).toEqual({
      memberStatuses: [200, 200, 200, 200, 200],
      nonMemberStatuses: [401, 401, 401, 401, 401],
    });
  });
});

describe("Person access enforcement refusals: the session scope is skipped only where GitHub decides (FR-035)", () => {
  beforeEach(() => {
    nowMs += 600_000;
    vi.useFakeTimers({ now: nowMs, toFake: ["Date"] });
    configureEnv();
    useMirrorOwner(async () => null);
  });

  afterEach(() => {
    useMirrorOwner(null);
    vi.useRealTimers();
    setPool(null as never);
    globalThis.fetch = ORIGINAL_FETCH;
    process.env = { ...ORIGINAL_ENV };
  });

  it("refuses a person whose session carries only the read scope from cancelling a floor run on POST /api/assembly-runs/{id}/cancel, and sends the floor nothing", async () => {
    const harness = createHarness({ installationRepos: ["acme/app"] });
    const floorRequests = recordFloorRequests();
    const token = await signIn(harness.server);

    harness.setSessionScopes(token, ["read"]);
    const res = await harness.server.inject({
      method: "POST",
      url: "/api/assembly-runs/run-fr035/cancel",
      headers: { authorization: `Bearer ${token}` },
      payload: {},
    });

    expect({ status: res.statusCode, floorRequests }).toEqual({
      status: 403,
      floorRequests: [],
    });
  });

  it("refuses a person whose session carries only the read scope on the organisation-wide admin route POST /api/tokens, minting nothing", async () => {
    const harness = createHarness({ installationRepos: ["acme/app"] });
    const token = await signIn(harness.server);

    harness.setSessionScopes(token, ["read"]);
    const tokensBefore = harness.apiTokens.length;
    const res = await harness.server.inject({
      method: "POST",
      url: "/api/tokens",
      headers: { authorization: `Bearer ${token}` },
      payload: { name: "fr035-escalation", scopes: ["admin"] },
    });

    expect({
      status: res.statusCode,
      minted: harness.apiTokens.length - tokensBefore,
    }).toEqual({ status: 403, minted: 0 });
  });

  it("refuses a service token carrying only the read scope on the write repository route POST /api/repos/{owner}/{repo}/branches with 403, writing nothing on GitHub", async () => {
    const harness = createHarness({
      installationRepos: ["acme/app"],
      permissions: { "acme/app": "admin" },
    });

    harness.repos.push(repoRow("acme/app"));
    const serviceToken = addServiceToken(harness.apiTokens, ["read"]);
    const res = await harness.server.inject({
      method: "POST",
      url: "/api/repos/acme/app/branches",
      headers: { authorization: `Bearer ${serviceToken}` },
      payload: { branch: "feat/fr035-service-read" },
    });

    expect({ status: res.statusCode, writes: harness.githubWrites }).toEqual({
      status: 403,
      writes: [],
    });
  });

  it("refuses a person with a read-scope session on a write repository route with 403, writing nothing, when GitHub's permission lookup errors", async () => {
    const harness = createHarness({
      installationRepos: ["acme/app"],
      permissions: { "acme/app": "write" },
    });

    harness.repos.push(repoRow("acme/app"));
    failPermissionLookups();
    const token = await signIn(harness.server);

    harness.setSessionScopes(token, ["read"]);
    const res = await harness.server.inject({
      method: "POST",
      url: "/api/repos/acme/app/branches",
      headers: { authorization: `Bearer ${token}` },
      payload: { branch: "feat/fr035-upstream-error" },
    });

    expect({ status: res.statusCode, writes: harness.githubWrites }).toEqual({
      status: 403,
      writes: [],
    });
  });
});

function recordFloorRequests(): string[] {
  const inner = globalThis.fetch;
  const seen: string[] = [];

  globalThis.fetch = async (input, init) => {
    const request = resolveFetchRequest(input, init);
    const url = new URL(request.url);

    if (
      url.hostname === "floor.example.com" &&
      url.pathname !== "/agent-definitions"
    ) {
      seen.push(`${request.method} ${url.pathname}`);
    }

    return inner(input, init);
  };

  return seen;
}

function failPermissionLookups(): void {
  const inner = globalThis.fetch;

  globalThis.fetch = async (input, init) => {
    const url = new URL(resolveFetchRequest(input, init).url);

    if (/\/collaborators\/[^/]+\/permission$/.test(url.pathname)) {
      return jsonResponse(
        { message: "Resource not accessible by integration" },
        403,
      );
    }

    return inner(input, init);
  };
}

function addServiceToken(
  apiTokens: Array<Record<string, unknown>>,
  scopes: string[],
): string {
  const token = `lore_svc_${randomBytes(16).toString("hex")}`;
  const now = new Date(Date.now());

  apiTokens.push({
    id: randomUUID(),
    name: "fr035-service",
    token_hash: createHash("sha256").update(token).digest("hex"),
    scopes,
    kind: "service",
    github_id: null,
    login: null,
    repos: null,
    created_at: now,
    membership_checked_at: now,
    revoked_at: null,
  });

  return token;
}

async function runPersonAppClientWrites(
  server: ReturnType<typeof buildServer>,
  token: string,
): Promise<{ personOctokitWrite: string; personProjectWrite: string }> {
  const octokitRes = await server.inject({
    method: "POST",
    url: "/api/repos/acme/app/_fr311/octokit-write",
    headers: { authorization: `Bearer ${token}` },
  });

  advanceDateBy(5_000);
  const projectRes = await server.inject({
    method: "POST",
    url: "/api/repos/acme/app/_fr311/project-write",
    headers: { authorization: `Bearer ${token}` },
  });

  return {
    personOctokitWrite: blockedOutcome(octokitRes.statusCode),
    personProjectWrite: blockedOutcome(projectRes.statusCode),
  };
}

async function runServiceAppClientWrites(
  server: ReturnType<typeof buildServer>,
): Promise<number[]> {
  advanceDateBy(5_000);
  const serviceOctokit = await server.inject({
    method: "POST",
    url: "/api/repos/acme/app/_fr311/octokit-write",
    headers: { authorization: `Bearer ${LEGACY_TOKEN}` },
  });

  advanceDateBy(5_000);
  const serviceProject = await server.inject({
    method: "POST",
    url: "/api/repos/acme/app/_fr311/project-write",
    headers: { authorization: `Bearer ${LEGACY_TOKEN}` },
  });

  return [serviceOctokit.statusCode, serviceProject.statusCode];
}

async function runWeakScopeRepoWrites(
  harness: ReturnType<typeof createHarness>,
  token: string,
): Promise<{ writeStatus: number; writeActor: string; adminStatus: number }> {
  const writeAdmitted = await harness.server.inject({
    method: "POST",
    url: "/api/repos/acme/app/branches",
    headers: { authorization: `Bearer ${token}` },
    payload: { branch: "feat/fr035-write" },
  });

  harness.setPermissions({ "acme/app": "admin" });
  const adminAdmitted = await harness.server.inject({
    method: "PUT",
    url: "/api/repos/acme/app/settings",
    headers: { authorization: `Bearer ${token}` },
    payload: { settings: { context_backend: "lore" } },
  });

  return {
    writeStatus: writeAdmitted.statusCode,
    writeActor: actorOf(harness.githubWrites[0]?.authorization ?? ""),
    adminStatus: adminAdmitted.statusCode,
  };
}

function advanceDateBy(ms: number): void {
  nowMs += ms;
  vi.advanceTimersByTime(ms);
}

function appClientProbeRoutes(): ServerRoute[] {
  return [
    {
      method: "POST",
      path: "/api/repos/{owner}/{repo}/_fr311/octokit-write",
      options: { ...bearerScope("write"), ...repoLevel("write") },
      handler: async (request, h) => {
        const octokit = await getOctokit();
        const { owner, repo } = request.params as {
          owner: string;
          repo: string;
        };

        await octokit.rest.issues.create({
          owner,
          repo,
          title: "fr311 octokit write",
          body: "probe",
        });

        return h.response({ ok: true });
      },
    },
    {
      method: "POST",
      path: "/api/repos/{owner}/{repo}/_fr311/project-write",
      options: { ...bearerScope("write"), ...repoLevel("write") },
      handler: async (request, h) => {
        const { owner, repo } = request.params as {
          owner: string;
          repo: string;
        };
        const project = await projectFor(`${owner}/${repo}`);

        await project.issues.create("fr311 project write", "probe");

        return h.response({ ok: true });
      },
    },
    {
      method: "GET",
      path: "/api/repos/{owner}/{repo}/_fr311/octokit-read",
      options: { ...bearerScope("read"), ...repoLevel("read") },
      handler: async (request, h) => {
        const octokit = await getOctokit();
        const { owner, repo } = request.params as {
          owner: string;
          repo: string;
        };
        const { data: repoPayload } = await octokit.rest.repos.get({
          owner,
          repo,
        });

        return h.response({ default_branch: repoPayload.default_branch });
      },
    },
  ];
}

async function callOrgWideRoutes(
  server: ReturnType<typeof buildServer>,
  token: string,
): Promise<number[]> {
  const paths = [
    "/api/agent-definitions",
    "/api/tokens",
    "/api/settings",
    "/api/pools",
    "/api/pack",
  ];
  const responses = await Promise.all(
    paths.map((url) =>
      server.inject({
        method: "GET",
        url,
        headers: { authorization: `Bearer ${token}` },
      }),
    ),
  );

  return responses.map((res) => res.statusCode);
}

function blockedOutcome(statusCode: number): string {
  if (statusCode === 500 || statusCode === 403) {
    return "blocked";
  }

  return `unexpected-status:${statusCode}`;
}

function actorOf(authorization: string): "person" | "app" | "other" {
  const carriesUser = authorization.includes(USER_ACCESS_TOKEN);
  const carriesApp = authorization.includes(APP_TOKEN);

  if (carriesUser && !carriesApp) {
    return "person";
  }

  return carriesApp ? "app" : "other";
}

function configureEnv(): void {
  process.env.LORE_INGEST_TOKEN = LEGACY_TOKEN;
  process.env.LORE_INGEST_URL = API_URL;
  process.env.LORE_API_URL = API_URL;
  process.env.LORE_UI_URL = UI_URL;
  process.env.FLOOR_API_URL = FLOOR_URL;
  process.env.FLOOR_SERVICE_TOKEN = "floor-service-token";
  process.env.GITHUB_APP_CLIENT_ID = "Iv1.testclient";
  process.env.GITHUB_APP_CLIENT_SECRET = "app-client-secret";
  process.env.GITHUB_APP_INSTALLATION_ID = INSTALLATION_ID;
  process.env.GITHUB_ORG = GITHUB_ORG;
  process.env.LORE_USER_TOKEN_ENCRYPTION_KEY = ENCRYPTION_KEY;
  process.env.GITHUB_TOKEN = APP_TOKEN;
}

type OrgMembership = "active" | "missing";

function createHarness(config: HarnessConfig) {
  const state = {
    repos: [] as RepoRecord[],
    apiTokens: [] as Array<Record<string, unknown>>,
    sessionTokens: [] as Array<Record<string, unknown>>,
    handoffs: new Map<string, Record<string, unknown>>(),
  };
  const githubWrites: RecordedGithubWrite[] = [];
  const pool = createFakePool(state);
  let permissions = { ...(config.permissions ?? {}) };
  let membership: OrgMembership = "active";

  setPool(pool as never);
  const server = buildServer(() => pool as never);

  globalThis.fetch = createFetchStub({
    installationRepos: config.installationRepos,
    getPermissions: () => permissions,
    getMembership: () => membership,
    githubWrites,
  });

  return {
    server,
    repos: state.repos,
    apiTokens: state.apiTokens,
    githubWrites,
    setPermissions: (next: Record<string, RepoPermission>) => {
      permissions = { ...next };
    },
    revokeOrgMembership: () => {
      membership = "missing";
    },
    setSessionScopes: (token: string, scopes: string[]) => {
      const hash = createHash("sha256").update(token).digest("hex");
      const row = state.apiTokens.find((entry) => entry.token_hash === hash);

      if (row) {
        row.scopes = scopes;
      }
    },
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

function repoRow(fullName: string): RepoRecord {
  const [owner, name] = fullName.split("/");

  return {
    id: randomUUID(),
    owner,
    name,
    fullName,
    onboardedAt: new Date(Date.now()),
    settings: { context_backend: "lore" },
  };
}

function createFetchStub(options: {
  installationRepos: string[];
  getPermissions: () => Record<string, RepoPermission>;
  getMembership: () => OrgMembership;
  githubWrites: RecordedGithubWrite[];
}): typeof fetch {
  return async (input, init) => {
    const request = resolveFetchRequest(input, init);
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
      return handleGithubApiFetch(url, request, options);
    }

    if (
      url.hostname === "floor.example.com" &&
      url.pathname === "/agent-definitions"
    ) {
      return jsonResponse({ items: [] });
    }

    return new Response("not found", { status: 404 });
  };
}

function resolveFetchRequest(
  input: string | URL | Request,
  init: RequestInit | undefined,
): {
  url: string;
  method: string;
  authorization: string;
} {
  const url = input instanceof Request ? input.url : input.toString();

  return {
    url,
    method: methodOf(input, init),
    authorization: authorizationOf(input, init),
  };
}

function methodOf(
  input: string | URL | Request,
  init: RequestInit | undefined,
): string {
  const raw = init?.method ?? (input instanceof Request ? input.method : "GET");

  return raw.toUpperCase();
}

function authorizationOf(
  input: string | URL | Request,
  init: RequestInit | undefined,
): string {
  const fromInit = headerValue(init?.headers, "authorization");

  if (fromInit) {
    return fromInit;
  }

  return input instanceof Request
    ? (input.headers.get("authorization") ?? "")
    : "";
}

function handleGithubApiFetch(
  url: URL,
  request: { method: string; authorization: string },
  options: {
    installationRepos: string[];
    getPermissions: () => Record<string, RepoPermission>;
    getMembership: () => OrgMembership;
    githubWrites: RecordedGithubWrite[];
  },
): Response {
  const identityReply = handleIdentityFetch(
    url,
    options.installationRepos,
    options.getMembership(),
  );

  if (identityReply) {
    return identityReply;
  }

  const permissionMatch =
    /^\/repos\/([^/]+\/[^/]+)\/collaborators\/[^/]+\/permission$/.exec(
      url.pathname,
    );

  if (permissionMatch && request.method === "GET") {
    const level = options.getPermissions()[permissionMatch[1]] ?? "none";

    return jsonResponse({ permission: level });
  }

  return handleGithubRepoOpsFetch(url, request, options.githubWrites);
}

function handleIdentityFetch(
  url: URL,
  installationRepos: string[],
  membership: OrgMembership,
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
    return membership === "active"
      ? jsonResponse({ state: "active", role: "member" })
      : jsonResponse({ message: "Not Found" }, 404);
  }

  if (url.pathname === `/user/installations/${INSTALLATION_ID}/repositories`) {
    return jsonResponse({
      total_count: installationRepos.length,
      repositories: installationRepos.map(toGithubRepoJson),
    });
  }

  return null;
}

function handleGithubRepoOpsFetch(
  url: URL,
  request: { method: string; authorization: string },
  githubWrites: RecordedGithubWrite[],
): Response {
  const key = `${request.method} ${decodeURIComponent(url.pathname)}`;

  if (/^GET \/repos\/[^/]+\/[^/]+$/.test(key)) {
    return jsonResponse({ default_branch: "main" });
  }

  if (/^GET \/repos\/[^/]+\/[^/]+\/git\/ref\/heads\/main$/.test(key)) {
    return jsonResponse({ object: { sha: "abc123" } });
  }

  if (/^POST \/repos\/[^/]+\/[^/]+\/git\/refs$/.test(key)) {
    githubWrites.push({
      method: request.method,
      path: url.pathname,
      authorization: request.authorization,
    });

    return jsonResponse({ ref: "refs/heads/feat/branch" }, 201);
  }

  if (/^POST \/repos\/[^/]+\/[^/]+\/issues$/.test(key)) {
    githubWrites.push({
      method: request.method,
      path: url.pathname,
      authorization: request.authorization,
    });

    return jsonResponse(
      {
        number: 99,
        title: "issue",
        state: "open",
        html_url: "https://github.com/acme/app/issues/99",
        labels: [],
      },
      201,
    );
  }

  return new Response("not found", { status: 404 });
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

function toGithubRepoJson(fullName: string) {
  const [owner, name] = fullName.split("/");

  return { full_name: fullName, name, owner: { login: owner } };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

interface PoolState {
  repos: RepoRecord[];
  apiTokens: Array<Record<string, unknown>>;
  sessionTokens: Array<Record<string, unknown>>;
  handoffs: Map<string, Record<string, unknown>>;
}

function createFakePool(state: PoolState) {
  const pool = makePool();
  const tx = { active: false, staged: clonePoolState(state) };

  pool.connect.mockImplementation(async () => ({
    query: async (rawSql: string, params: unknown[] = []) =>
      runTxQuery(tx, state, String(rawSql), params),
    release: vi.fn(),
  }));

  pool.query.mockImplementation(
    async (rawSql: string, params: unknown[] = []) =>
      executePoolSql(state, String(rawSql), params),
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
    matches: (sql) => sql.includes("pipeline.api_tokens"),
    run: (state, sql, params) => handleApiTokensSql(state, sql, params),
  },
  {
    matches: (sql) => sql.includes("pipeline.user_session_tokens"),
    run: (state, sql, params) => handleSessionTokensSql(state, sql, params),
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
  if (sql.includes("INSERT INTO lore.login_handoffs")) {
    return insertHandoff(handoffs, sql, params);
  }

  return sql.includes("RETURNING")
    ? claimHandoff(handoffs, params)
    : { rows: [] };
}

function insertHandoff(
  handoffs: Map<string, Record<string, unknown>>,
  sql: string,
  params: unknown[],
): { rows: Array<Record<string, unknown>> } {
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

  if (sql.includes("SELECT count(*)::int as total FROM pipeline.api_tokens")) {
    return { rows: [{ total: 0 }] };
  }

  if (sql.includes("UPDATE pipeline.api_tokens")) {
    return updateApiTokenRow(state, sql, params);
  }

  if (sql.includes("WHERE token_hash = $1")) {
    const row = state.apiTokens.find((entry) => entry.token_hash === params[0]);

    return { rows: row ? [projectTokenRow(state, row)] : [] };
  }

  return { rows: [] };
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
    membership_checked_at: now,
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
  state: PoolState,
  sql: string,
  params: unknown[],
): { rows: Array<Record<string, unknown>> } {
  if (sql.includes("WHERE github_id = $1")) {
    updateTokensByGithubId(state.apiTokens, sql, params[0]);

    return { rows: [] };
  }

  const row = state.apiTokens.find((entry) => entry.token_hash === params[0]);

  if (!row || row.revoked_at !== null) {
    return { rows: [] };
  }
  applyTokenUpdates(row, sql, params);

  return {
    rows: sql.includes("RETURNING") ? [projectTokenRow(state, row)] : [],
  };
}

function updateTokensByGithubId(
  apiTokens: Array<Record<string, unknown>>,
  sql: string,
  githubId: unknown,
): void {
  const now = new Date(Date.now());

  for (const row of apiTokens) {
    if (String(row.github_id) !== String(githubId)) {
      continue;
    }

    if (sql.includes("revoked_at = now()")) {
      row.revoked_at = now;
    }

    if (sql.includes("membership_checked_at = now()")) {
      row.membership_checked_at = now;
    }
  }
}

function applyTokenUpdates(
  row: Record<string, unknown>,
  sql: string,
  params: unknown[],
): void {
  const now = new Date(Date.now());

  if (sql.includes("last_used = now()")) {
    row.last_used = now;
  }

  const reposMatch = /repos\s*=\s*\$(\d+)/i.exec(sql);

  if (reposMatch) {
    row.repos = params[Number(reposMatch[1]) - 1];
  }

  if (sql.includes("repos_refreshed_at = now()")) {
    row.repos_refreshed_at = now;
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
    membership_checked_at: row.membership_checked_at ?? row.created_at,
    reposRefreshedAt: refreshedAt,
    encryptedTokens,
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

function handleReposSql(
  repos: RepoRecord[],
  sql: string,
  params: unknown[],
): { rows: Array<Record<string, unknown>> } {
  if (sql.includes("SELECT count(*)::int as count FROM lore.repos")) {
    return { rows: [{ count: repos.length }] };
  }

  const found = repos.find((repo) => repo.fullName === params[0]);

  if (sql.includes("SELECT full_name, team FROM lore.repos")) {
    return {
      rows: found ? [{ full_name: found.fullName, team: null }] : [],
    };
  }

  return { rows: found ? [toRepoRow(found)] : [] };
}

function toRepoRow(repo: RepoRecord): Record<string, unknown> {
  return {
    id: repo.id,
    owner: repo.owner,
    name: repo.name,
    full_name: repo.fullName,
    github_url: `https://github.com/${repo.fullName}`,
    default_branch: "main",
    team: null,
    onboarded_at: repo.onboardedAt,
    onboarding_pr_url: null,
    onboarding_pr_merged: false,
    settings: repo.settings,
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

describe("Person access enforcement test-review refusals: skipping the session scope on a repository route lets no one else through (FR-035)", () => {
  beforeEach(() => {
    nowMs += 600_000;
    vi.useFakeTimers({ now: nowMs, toFake: ["Date"] });
    configureEnv();
    useMirrorOwner(async () => null);
  });

  afterEach(() => {
    useMirrorOwner(null);
    vi.useRealTimers();
    setPool(null as never);
    globalThis.fetch = ORIGINAL_FETCH;
    process.env = { ...ORIGINAL_ENV };
  });

  it("refuses a caller with no credential and one with a made-up bearer on the write repository route POST /api/repos/{owner}/{repo}/branches with 401, writing nothing on GitHub", async () => {
    const harness = createHarness({
      installationRepos: ["acme/app"],
      permissions: { "acme/app": "admin" },
    });

    harness.repos.push(repoRow("acme/app"));
    const anonymous = await harness.server.inject({
      method: "POST",
      url: "/api/repos/acme/app/branches",
      payload: { branch: "feat/anonymous" },
    });
    const madeUp = await harness.server.inject({
      method: "POST",
      url: "/api/repos/acme/app/branches",
      headers: {
        authorization: `Bearer lore_${randomBytes(16).toString("hex")}`,
      },
      payload: { branch: "feat/made-up" },
    });

    expect({
      statuses: [anonymous.statusCode, madeUp.statusCode],
      writes: harness.githubWrites,
    }).toEqual({ statuses: [401, 401], writes: [] });
  });

  it("refuses a person with an admin session scope on a write route of a repository GitHub gives them no access to, writing nothing on GitHub", async () => {
    const harness = createHarness({
      installationRepos: ["acme/app"],
      permissions: { "acme/app": "admin", "acme/secret": "none" },
    });

    harness.repos.push(repoRow("acme/app"), repoRow("acme/secret"));
    const token = await signIn(harness.server);

    harness.setSessionScopes(token, ["admin"]);
    const res = await harness.server.inject({
      method: "POST",
      url: "/api/repos/acme/secret/branches",
      headers: { authorization: `Bearer ${token}` },
      payload: { branch: "feat/someone-elses-repo" },
    });

    expect({ status: res.statusCode, writes: harness.githubWrites }).toEqual({
      status: 403,
      writes: [],
    });
  });

  it("refuses a person with a read-scope session on a write repository route with 403, writing nothing, when GitHub's permission lookup answers a level that is not one of its own", async () => {
    const harness = createHarness({
      installationRepos: ["acme/app"],
      permissions: { "acme/app": "superuser" as RepoPermission },
    });

    harness.repos.push(repoRow("acme/app"));
    const token = await signIn(harness.server);

    harness.setSessionScopes(token, ["read"]);
    const res = await harness.server.inject({
      method: "POST",
      url: "/api/repos/acme/app/branches",
      headers: { authorization: `Bearer ${token}` },
      payload: { branch: "feat/not-an-answer" },
    });

    expect({ status: res.statusCode, writes: harness.githubWrites }).toEqual({
      status: 403,
      writes: [],
    });
  });

  it("refuses a person who has left the organisation, whose session still carries the admin scope, on a write repository route with 401, writing nothing on GitHub", async () => {
    const harness = createHarness({
      installationRepos: ["acme/app"],
      permissions: { "acme/app": "admin" },
    });

    harness.repos.push(repoRow("acme/app"));
    const token = await signIn(harness.server);

    harness.setSessionScopes(token, ["admin"]);
    harness.revokeOrgMembership();
    advanceDateBy(5 * 60_000 + 1_000);
    const res = await harness.server.inject({
      method: "POST",
      url: "/api/repos/acme/app/branches",
      headers: { authorization: `Bearer ${token}` },
      payload: { branch: "feat/left-the-org" },
    });

    expect({ status: res.statusCode, writes: harness.githubWrites }).toEqual({
      status: 401,
      writes: [],
    });
  });

  it("refuses a person with write access to one repository whose write route path climbs out of it into another, writing nothing on GitHub", async () => {
    const harness = createHarness({
      installationRepos: ["acme/app"],
      permissions: { "acme/app": "write", "acme/secret": "none" },
    });

    harness.repos.push(repoRow("acme/app"), repoRow("acme/secret"));
    const token = await signIn(harness.server);

    harness.setSessionScopes(token, ["read"]);
    const res = await harness.server.inject({
      method: "POST",
      url: "/api/repos/acme/app%2F..%2F..%2Facme%2Fsecret/branches",
      headers: { authorization: `Bearer ${token}` },
      payload: { branch: "feat/climb-out" },
    });

    expect({
      refused: res.statusCode >= 400 && res.statusCode < 500,
      writes: harness.githubWrites,
    }).toEqual({ refused: true, writes: [] });
  });
});
