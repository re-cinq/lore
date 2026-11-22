import { createSign, generateKeyPairSync } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setPool } from "@re-cinq/lore-server-core/platform/db.js";
import { makePool } from "@re-cinq/lore-server-core/test-helpers/http-mock.js";
import { buildServer } from "../../app/build-server.js";

const ISSUER = "https://token.actions.githubusercontent.com";
const API_URL = "https://lore-api.example";
const DGRAPH_HTTP = "http://dgraph.test:8080";
const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);

const originalEnv = { ...process.env };
const originalFetch = globalThis.fetch;

const TRUSTED_KEYS = generateKeyPairSync("rsa", { modulusLength: 2048 });
const TRUSTED_JWK = {
  ...TRUSTED_KEYS.publicKey.export({ format: "jwk" }),
  kid: "k1",
  alg: "RS256",
  use: "sig",
};

const ONBOARDED_REPO_ROW = {
  id: "r-acme",
  owner: "acme",
  name: "app",
  full_name: "acme/app",
  default_branch: "main",
  github_id: "1001",
  owner_id: "2001",
  github_repo_id: "1001",
  github_owner_id: "2001",
  repository_id: "1001",
  repository_owner_id: "2001",
};

const BASE_NOW_MS = Date.parse("2026-11-21T12:00:00Z");

let testClockStep = 0;
let currentNowMs = BASE_NOW_MS;

describe("GitHub Actions identity token authorization per route and ref", () => {
  beforeEach(() => {
    currentNowMs = BASE_NOW_MS + testClockStep++ * 120_000;
    vi.useFakeTimers({ now: currentNowMs, toFake: ["Date"] });
    process.env.LORE_API_URL = API_URL;
    process.env.LORE_DGRAPH_HTTP = DGRAPH_HTTP;
    delete process.env.GITHUB_HOST;
    installOidcFetch();
  });

  afterEach(() => {
    vi.useRealTimers();
    setPool(null as never);
    process.env = { ...originalEnv };
    globalThis.fetch = originalFetch;
  });

  it("allows default-branch identity tokens on ingest routes for their own repository and refuses other repositories", async () => {
    const nowSec = Math.floor(currentNowMs / 1000);
    const { server, sqlCalls } = createServer();
    const token = signJwt(baseClaims(nowSec));
    const own = await probeIngestRoutes(server, token, "acme/app", []);
    const sqlCountBeforeRefusal = sqlCalls.length;
    const foreign = await probeIngestRoutes(server, token, "other/secret", [
      { path: "README.md", content: "planted" },
    ]);
    const writesOnForeignRefusal = sqlCalls
      .slice(sqlCountBeforeRefusal)
      .filter(isIngestMutationOrStateQuery);

    expect({
      own,
      foreign,
      writesOnForeignRefusal,
    }).toEqual({
      own: { delta: 200, state: 200, legacy: 200 },
      foreign: { delta: 403, state: 403, legacy: 403 },
      writesOnForeignRefusal: [],
    });
  });

  it("refuses identity tokens from refs other than the default branch on every ingest route", async () => {
    const nowSec = Math.floor(currentNowMs / 1000);
    const { server, sqlCalls } = createServer();
    const refVariants = [
      {
        ref: "refs/heads/feature/x",
        ref_type: "branch",
        event_name: "push",
        sub: "repo:acme/app:ref:refs/heads/feature/x",
      },
      {
        ref: "refs/pull/42/merge",
        ref_type: "branch",
        event_name: "pull_request",
        head_ref: "feature/x",
        base_ref: "main",
        sub: "repo:acme/app:pull_request",
      },
      {
        ref: "refs/tags/v1.0.0",
        ref_type: "tag",
        event_name: "push",
        sub: "repo:acme/app:ref:refs/tags/v1.0.0",
      },
    ];
    const results: Array<{
      ref: string;
      delta: number;
      state: number;
      legacy: number;
    }> = [];

    for (const variant of refVariants) {
      const token = signJwt({ ...baseClaims(nowSec), ...variant });
      const statuses = await probeIngestRoutes(server, token, "acme/app", [
        { path: "README.md", content: "planted" },
      ]);

      results.push({ ref: variant.ref, ...statuses });
    }

    expect({
      results,
      writesOnRefusal: sqlCalls.filter(isIngestMutationOrStateQuery),
    }).toEqual({
      results: [
        { ref: "refs/heads/feature/x", delta: 403, state: 403, legacy: 403 },
        { ref: "refs/pull/42/merge", delta: 403, state: 403, legacy: 403 },
        { ref: "refs/tags/v1.0.0", delta: 403, state: 403, legacy: 403 },
      ],
      writesOnRefusal: [],
    });
  });

  it("allows identity tokens from any ref on check routes of their repository and spec-links parse, and refuses other repositories and all other routes", async () => {
    const nowSec = Math.floor(currentNowMs / 1000);
    const { server } = createServer();
    const defaultToken = signJwt(baseClaims(nowSec));
    const pullRequestToken = signJwt({
      ...baseClaims(nowSec),
      sub: "repo:acme/app:pull_request",
      ref: "refs/pull/42/merge",
      head_ref: "feature/x",
      base_ref: "main",
      event_name: "pull_request",
    });

    const allowedDefault = await probeCheckRoutes(
      server,
      defaultToken,
      "acme/app",
    );
    const allowedPr = await probeCheckRoutes(
      server,
      pullRequestToken,
      "acme/app",
    );
    const foreignPr = await probeCheckRoutes(
      server,
      pullRequestToken,
      "other/secret",
    );
    const otherRoutesDefault = await probeNonCiRoutes(server, defaultToken);
    const otherRoutesPr = await probeNonCiRoutes(server, pullRequestToken);

    expect({
      allowedDefault,
      allowedPr,
      foreignImpactBase: foreignPr.impactBase,
      foreignImpact: foreignPr.impact,
      otherRoutesDefault,
      otherRoutesPr,
    }).toEqual({
      allowedDefault: { impactBase: 200, impact: 200, specLinksParse: 200 },
      allowedPr: { impactBase: 200, impact: 200, specLinksParse: 200 },
      foreignImpactBase: 403,
      foreignImpact: 403,
      otherRoutesDefault: {
        memory: 403,
        episode: 403,
        chunksPrune: 403,
        context: 403,
        repos: 403,
        repoStatus: 403,
        traceSpecs: 403,
        repoSettings: 403,
        taskPost: 403,
      },
      otherRoutesPr: {
        memory: 403,
        episode: 403,
        chunksPrune: 403,
        context: 403,
        repos: 403,
        repoStatus: 403,
        traceSpecs: 403,
        repoSettings: 403,
        taskPost: 403,
      },
    });
  });

  it("accepts an identity token from any workflow file of the repository with access determined by its ref", async () => {
    const nowSec = Math.floor(currentNowMs / 1000);
    const { server } = createServer();
    const customMainToken = signJwt({
      ...baseClaims(nowSec),
      workflow: "Custom Pipeline",
      workflow_ref:
        "acme/app/.github/workflows/custom-check.yml@refs/heads/main",
      job_workflow_ref:
        "acme/app/.github/workflows/custom-check.yml@refs/heads/main",
    });
    const customFeatureToken = signJwt({
      ...baseClaims(nowSec),
      sub: "repo:acme/app:ref:refs/heads/feature/custom",
      ref: "refs/heads/feature/custom",
      workflow: "Custom Pipeline",
      workflow_ref:
        "acme/app/.github/workflows/custom-check.yml@refs/heads/feature/custom",
      job_workflow_ref:
        "acme/app/.github/workflows/custom-check.yml@refs/heads/feature/custom",
    });

    const mainAllowed = await probeAllCiRoutes(server, customMainToken);
    const featureAllowed = await probeAllCiRoutes(server, customFeatureToken);

    expect({ mainAllowed, featureAllowed }).toEqual({
      mainAllowed: {
        delta: 200,
        state: 200,
        legacy: 200,
        impactBase: 200,
        impact: 200,
        specLinksParse: 200,
      },
      featureAllowed: {
        delta: 403,
        state: 403,
        legacy: 403,
        impactBase: 200,
        impact: 200,
        specLinksParse: 200,
      },
    });
  });
  it("compares the token's ref with the repository's own default branch, not main, on every ingest route", async () => {
    const nowSec = Math.floor(currentNowMs / 1000);
    const { server, sqlCalls } = createServerWith({ defaultBranch: "develop" });
    const mainToken = signJwt(baseClaims(nowSec));
    const developToken = signJwt({
      ...baseClaims(nowSec),
      sub: "repo:acme/app:ref:refs/heads/develop",
      ref: "refs/heads/develop",
    });
    const fromMain = await probeIngestRoutes(server, mainToken, "acme/app", [
      { path: "README.md", content: "planted" },
    ]);
    const writesFromMain = sqlCalls.filter(isIngestMutationOrStateQuery);
    const fromDevelop = await probeIngestRoutes(
      server,
      developToken,
      "acme/app",
      [],
    );

    expect({ fromMain, writesFromMain, fromDevelop }).toEqual({
      fromMain: { delta: 403, state: 403, legacy: 403 },
      writesFromMain: [],
      fromDevelop: { delta: 200, state: 200, legacy: 200 },
    });
  });

  it("refuses a default-branch identity token on every ingest route and writes nothing when the default branch lookup fails", async () => {
    const nowSec = Math.floor(currentNowMs / 1000);
    const { server, sqlCalls } = createServerWith({
      defaultBranchLookupFails: true,
    });
    const token = signJwt(baseClaims(nowSec));
    const statuses = await probeIngestRoutes(server, token, "acme/app", [
      { path: "README.md", content: "planted" },
    ]);

    expect({
      refused: Object.values(statuses).every((status) => status >= 400),
      writes: sqlCalls.filter(isIngestMutationOrStateQuery),
    }).toEqual({ refused: true, writes: [] });
  });

  it("matches the token's repository without regard to letter case", async () => {
    const nowSec = Math.floor(currentNowMs / 1000);
    const { server } = createServerWith({});
    const token = signJwt(baseClaims(nowSec));
    const ingest = await probeIngestRoutes(server, token, "ACME/App", []);
    const checks = await probeCheckRoutes(server, token, "ACME/App");

    expect({ ...ingest, ...checks }).toEqual({
      delta: 200,
      state: 200,
      legacy: 200,
      impactBase: 200,
      impact: 200,
      specLinksParse: 200,
    });
  });
});

async function probeIngestRoutes(
  server: ReturnType<typeof buildServer>,
  token: string,
  repo: string,
  legacyFiles: Array<{ path: string; content: string }>,
) {
  const delta = await callJson(server, token, {
    method: "POST",
    url: `/api/repos/${repo}/ingest`,
    payload: validDeltaPayload(),
  });
  const state = await callJson(server, token, {
    method: "GET",
    url: `/api/repos/${repo}/ingest-state?kind=specs`,
  });
  const legacy = await callJson(server, token, {
    method: "POST",
    url: "/api/ingest",
    payload: { repo, files: legacyFiles },
  });

  return {
    delta: delta.statusCode,
    state: state.statusCode,
    legacy: legacy.statusCode,
  };
}

function validDeltaPayload(): Record<string, unknown> {
  return {
    kind: "specs",
    commit: SHA_B,
    base_commit: SHA_A,
    files: [],
  };
}

async function probeCheckRoutes(
  server: ReturnType<typeof buildServer>,
  token: string,
  repo: string,
) {
  const impactBase = await callJson(server, token, {
    method: "GET",
    url: `/api/repos/${repo}/impact/base`,
  });
  const impact = await callJson(server, token, {
    method: "POST",
    url: `/api/repos/${repo}/impact`,
    payload: { protocol: 2, files: [], docs: [] },
  });
  const specLinksParse = await callJson(server, token, {
    method: "POST",
    url: "/api/spec-links/parse",
    payload: {
      docs: [{ path: "specs/a/spec.md", content: "- Statement.\\n" }],
    },
  });

  return {
    impactBase: impactBase.statusCode,
    impact: impact.statusCode,
    specLinksParse: specLinksParse.statusCode,
  };
}

async function probeAllCiRoutes(
  server: ReturnType<typeof buildServer>,
  token: string,
) {
  const ingest = await probeIngestRoutes(server, token, "acme/app", []);
  const checks = await probeCheckRoutes(server, token, "acme/app");

  return { ...ingest, ...checks };
}

async function probeNonCiRoutes(
  server: ReturnType<typeof buildServer>,
  token: string,
) {
  const writes = await probeNonCiWriteRoutes(server, token);
  const reads = await probeNonCiReadRoutes(server, token);

  return { ...writes, ...reads };
}

async function probeNonCiWriteRoutes(
  server: ReturnType<typeof buildServer>,
  token: string,
) {
  const memory = await callJson(server, token, {
    method: "POST",
    url: "/api/memory",
    payload: { action: "write", key: "k", value: "v", repo: "acme/app" },
  });
  const episode = await callJson(server, token, {
    method: "POST",
    url: "/api/episode",
    payload: { content: "secret episode" },
  });
  const chunksPrune = await callJson(server, token, {
    method: "POST",
    url: "/api/repos/acme/app/chunks/prune",
    payload: { present_paths: ["README.md"] },
  });
  const repoSettings = await callJson(server, token, {
    method: "PUT",
    url: "/api/repos/acme/app/settings",
    payload: { team: "core" },
  });
  const taskPost = await callJson(server, token, {
    method: "POST",
    url: "/api/task",
    payload: { action: "cancel", task_id: "t-1" },
  });

  return {
    memory: memory.statusCode,
    episode: episode.statusCode,
    chunksPrune: chunksPrune.statusCode,
    repoSettings: repoSettings.statusCode,
    taskPost: taskPost.statusCode,
  };
}

async function probeNonCiReadRoutes(
  server: ReturnType<typeof buildServer>,
  token: string,
) {
  const context = await callJson(server, token, {
    method: "POST",
    url: "/api/context",
    payload: { query: "q", repo: "acme/app" },
  });
  const repos = await callJson(server, token, {
    method: "GET",
    url: "/api/repos",
  });
  const repoStatus = await callJson(server, token, {
    method: "GET",
    url: "/api/repo-status?repo=acme/app",
  });
  const traceSpecs = await callJson(server, token, {
    method: "GET",
    url: "/api/repos/acme/app/trace/specs",
  });

  return {
    context: context.statusCode,
    repos: repos.statusCode,
    repoStatus: repoStatus.statusCode,
    traceSpecs: traceSpecs.statusCode,
  };
}

function callJson(
  server: ReturnType<typeof buildServer>,
  token: string,
  request: {
    method: "GET" | "POST" | "PUT";
    url: string;
    payload?: Record<string, unknown>;
  },
) {
  return server.inject({
    method: request.method,
    url: request.url,
    headers: { authorization: `Bearer ${token}` },
    ...(request.payload ? { payload: request.payload } : {}),
  });
}

function createServer() {
  const pool = makePool();
  const sqlCalls: string[] = [];

  pool.query.mockImplementation((rawSql: string, params?: unknown[]) => {
    const sql = String(rawSql);

    sqlCalls.push(sql);

    return Promise.resolve({ rows: queryRowsFor(sql, params) });
  });
  setPool(pool as never);

  return { server: buildServer(() => pool as never), sqlCalls };
}

function createServerWith(options: {
  defaultBranch?: string;
  defaultBranchLookupFails?: boolean;
}) {
  const pool = makePool();
  const sqlCalls: string[] = [];

  pool.query.mockImplementation((rawSql: string, params?: unknown[]) => {
    const sql = String(rawSql);

    sqlCalls.push(sql);

    if (
      sql.includes("SELECT default_branch") &&
      options.defaultBranchLookupFails
    ) {
      return Promise.reject(new Error("connection reset"));
    }

    if (sql.includes("FROM lore.repos") && matchesOnboardedRepo(params)) {
      return Promise.resolve({
        rows: [
          {
            ...ONBOARDED_REPO_ROW,
            default_branch:
              options.defaultBranch ?? ONBOARDED_REPO_ROW.default_branch,
          },
        ],
      });
    }

    return Promise.resolve({ rows: ingestStateRowsFor(sql) });
  });
  setPool(pool as never);

  return { server: buildServer(() => pool as never), sqlCalls };
}

function queryRowsFor(
  sql: string,
  params?: unknown[],
): Array<Record<string, unknown>> {
  if (sql.includes("FROM lore.repos") && matchesOnboardedRepo(params)) {
    return [ONBOARDED_REPO_ROW];
  }

  return ingestStateRowsFor(sql);
}

function ingestStateRowsFor(sql: string): Array<Record<string, unknown>> {
  if (sql.includes("pipeline.ingest_state") && sql.includes("SELECT")) {
    return [{ commit_sha: SHA_A }];
  }

  if (sql.includes("pipeline.ingest_state") && sql.includes("INSERT")) {
    return [{ commit_sha: SHA_B }];
  }

  return [];
}

function matchesOnboardedRepo(params?: unknown[]): boolean {
  if (!params || params.length < 2) {
    return false;
  }

  return String(params[0]) === "1001" && String(params[1]) === "2001";
}

function isIngestMutationOrStateQuery(sql: string): boolean {
  return (
    sql.includes("pipeline.ingest_state") ||
    sql.includes(".chunks") ||
    sql.includes("UPDATE lore.repos")
  );
}

function installOidcFetch(): void {
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input.toString();

    if (url === `${ISSUER}/.well-known/openid-configuration`) {
      return jsonResponse({ jwks_uri: `${ISSUER}/.well-known/jwks` });
    }

    if (url === `${ISSUER}/.well-known/jwks`) {
      return jsonResponse({ keys: [TRUSTED_JWK] });
    }

    return new Response("not found", { status: 404 });
  }) as typeof fetch;
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function baseClaims(nowSec: number): Record<string, unknown> {
  return {
    iss: ISSUER,
    aud: API_URL,
    sub: "repo:acme/app:ref:refs/heads/main",
    repository: "acme/app",
    repository_id: "1001",
    repository_owner: "acme",
    repository_owner_id: "2001",
    ref: "refs/heads/main",
    ref_type: "branch",
    event_name: "push",
    repository_visibility: "private",
    workflow: "Lore Ingest",
    workflow_ref: "acme/app/.github/workflows/lore.yml@refs/heads/main",
    job_workflow_ref: "acme/app/.github/workflows/lore.yml@refs/heads/main",
    iat: nowSec - 30,
    nbf: nowSec - 30,
    exp: nowSec + 300,
  };
}

function signJwt(claims: Record<string, unknown>): string {
  const header = toBase64Url(
    JSON.stringify({ alg: "RS256", typ: "JWT", kid: "k1" }),
  );
  const payload = toBase64Url(JSON.stringify(claims));
  const signingInput = `${header}.${payload}`;
  const signature = createSign("RSA-SHA256")
    .update(signingInput)
    .sign(TRUSTED_KEYS.privateKey)
    .toString("base64url");

  return `${signingInput}.${signature}`;
}

function toBase64Url(input: string | Buffer): string {
  return Buffer.from(input).toString("base64url");
}
