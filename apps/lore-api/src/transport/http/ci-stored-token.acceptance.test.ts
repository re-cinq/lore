import { createHash, createSign, generateKeyPairSync } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setPool } from "@re-cinq/lore-server-core/platform/db.js";
import { makePool } from "@re-cinq/lore-server-core/test-helpers/http-mock.js";
import { buildServer } from "../../app/build-server.js";

const ISSUER = "https://token.actions.githubusercontent.com";
const API_URL = "https://lore-api.example";
const BASE_NOW_MS = Date.parse("2026-11-21T12:00:00Z");
const SHA_A = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const SHA_B = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

const TRUSTED_KEYS = generateKeyPairSync("rsa", { modulusLength: 2048 });
const TRUSTED_JWK = {
  ...TRUSTED_KEYS.publicKey.export({ format: "jwk" }),
  kid: "k1",
  alg: "RS256",
  use: "sig",
};

interface RepoFixture {
  id: string;
  owner: string;
  name: string;
  full_name: string;
  default_branch: string;
  github_id: string | null;
  owner_id: string | null;
}

interface TokenFixture {
  id: string;
  token: string;
  kind: "ci" | "service" | "user";
  scopes: string[];
  github_repo_id: string | null;
}

const ACME_REPO: RepoFixture = {
  id: "r-acme",
  owner: "acme",
  name: "app",
  full_name: "acme/app",
  default_branch: "main",
  github_id: "1001",
  owner_id: "2001",
};

const OTHER_REPO: RepoFixture = {
  id: "r-other",
  owner: "other",
  name: "secret",
  full_name: "other/secret",
  default_branch: "main",
  github_id: "9999",
  owner_id: "2001",
};

const CI_TOKEN_ACME = "lore_ci_acme_1001_stored_token";
const CI_TOKEN_UNBOUND = "lore_ci_unbound_stored_token";
const CI_TOKEN_UNKNOWN_REPO = "lore_ci_unknown_repo_stored_token";

const BASE_TOKENS: TokenFixture[] = [
  {
    id: "tok-ci-acme",
    token: CI_TOKEN_ACME,
    kind: "ci",
    scopes: [],
    github_repo_id: "1001",
  },
  {
    id: "tok-ci-unbound",
    token: CI_TOKEN_UNBOUND,
    kind: "ci",
    scopes: ["read", "write"],
    github_repo_id: null,
  },
  {
    id: "tok-ci-unknown",
    token: CI_TOKEN_UNKNOWN_REPO,
    kind: "ci",
    scopes: ["read", "write"],
    github_repo_id: "7777",
  },
];

const originalEnv = { ...process.env };
const originalFetch = globalThis.fetch;

describe("Repository stored CI token kind and authorization", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: BASE_NOW_MS, toFake: ["Date"] });
    process.env.LORE_DGRAPH_HTTP = "http://dgraph.test:8080";
    process.env.LORE_API_URL = API_URL;
    delete process.env.LORE_INGEST_TOKEN;
    delete process.env.GITHUB_HOST;
    installOidcFetch();
  });

  afterEach(() => {
    vi.useRealTimers();
    process.env = { ...originalEnv };
    globalThis.fetch = originalFetch;
    setPool(null as never);
  });

  it("authenticates a stored ci token bound to an onboarded repository's GitHub numeric id and refuses unbound, unmatched, or ambiguous ids", async () => {
    const { server } = createServerWith({
      repos: [ACME_REPO, OTHER_REPO],
      tokens: BASE_TOKENS,
    });
    const { server: renamedServer } = createServerWith({
      repos: [
        { ...ACME_REPO, name: "renamed", full_name: "acme/renamed" },
        OTHER_REPO,
      ],
      tokens: BASE_TOKENS,
    });
    const { server: duplicateIdServer } = createServerWith({
      repos: [
        ACME_REPO,
        {
          id: "r-acme-dup",
          owner: "acme",
          name: "clone",
          full_name: "acme/clone",
          default_branch: "main",
          github_id: "1001",
          owner_id: "2001",
        },
      ],
      tokens: BASE_TOKENS,
    });

    const boundOwnRepo = await postIngest(server, CI_TOKEN_ACME, "acme/app");
    const renamedMatch = await postIngest(
      renamedServer,
      CI_TOKEN_ACME,
      "acme/renamed",
    );
    const oldNameAfterRename = await postIngest(
      renamedServer,
      CI_TOKEN_ACME,
      "acme/app",
    );
    const unboundToken = await postIngest(server, CI_TOKEN_UNBOUND, "acme/app");
    const unmatchedRepo = await postIngest(
      server,
      CI_TOKEN_UNKNOWN_REPO,
      "acme/app",
    );
    const duplicateRepoId = await postIngest(
      duplicateIdServer,
      CI_TOKEN_ACME,
      "acme/app",
    );

    expect({
      boundOwnRepo,
      renamedMatch,
      oldNameAfterRename,
      unboundRefused: unboundToken === 401 || unboundToken === 403,
      unmatchedRefused: unmatchedRepo === 401 || unmatchedRepo === 403,
      duplicateRefused: duplicateRepoId === 401 || duplicateRepoId === 403,
    }).toEqual({
      boundOwnRepo: 200,
      renamedMatch: 200,
      oldNameAfterRename: 403,
      unboundRefused: true,
      unmatchedRefused: true,
      duplicateRefused: true,
    });
  });

  it("accepts a repository's stored ci token on all ingest and check routes for its own repository without branch restriction", async () => {
    const { server } = createServerWith({
      repos: [{ ...ACME_REPO, default_branch: "develop" }, OTHER_REPO],
      tokens: BASE_TOKENS,
    });

    expect({
      ...(await probeCiRoutes(server, CI_TOKEN_ACME, "acme/app")),
      caseInsensitiveIngest: await postIngest(
        server,
        CI_TOKEN_ACME,
        "ACME/App",
      ),
    }).toEqual({
      legacyIngest: 200,
      deltaIngest: 200,
      ingestState: 200,
      impactBase: 200,
      impact: 200,
      specLinksParse: 200,
      caseInsensitiveIngest: 200,
    });
  });

  it("refuses a repository's stored ci token on every other route regardless of the scopes on the token row", async () => {
    const { server } = createServerWith({
      repos: [ACME_REPO, OTHER_REPO],
      tokens: [
        {
          id: "tok-ci-all-scopes",
          token: CI_TOKEN_ACME,
          kind: "ci",
          scopes: ["read", "write", "task", "webhook", "admin"],
          github_repo_id: "1001",
        },
      ],
    });

    expect(await probeOtherRoutes(server, CI_TOKEN_ACME)).toEqual({
      memory: 403,
      episode: 403,
      chunksPrune: 403,
      settings: 403,
      task: 403,
      context: 403,
      repos: 403,
      repoStatus: 403,
      traceSpecs: 403,
      tokens: 403,
    });
  });

  it("refuses a repository's stored ci token for any other repository", async () => {
    const { server, sqlCalls } = createServerWith({
      repos: [ACME_REPO, OTHER_REPO],
      tokens: [
        {
          id: "tok-ci-acme-scoped",
          token: CI_TOKEN_ACME,
          kind: "ci",
          scopes: ["read", "write"],
          github_repo_id: "1001",
        },
      ],
    });

    const statuses = await probeRepoCiRoutes(
      server,
      CI_TOKEN_ACME,
      "other/secret",
    );
    const mutations = sqlCalls.filter(isIngestMutationOrStateQuery);

    expect({ statuses, mutations }).toEqual({
      statuses: {
        legacyIngest: 403,
        deltaIngest: 403,
        ingestState: 403,
        impactBase: 403,
        impact: 403,
      },
      mutations: [],
    });
  });

  it("refuses a request on the ci routes with no bearer or a made-up stored ci token", async () => {
    const { server, sqlCalls } = createServerWith({
      repos: [ACME_REPO, OTHER_REPO],
      tokens: BASE_TOKENS,
    });

    const noBearer = (
      await server.inject({
        method: "POST",
        url: "/api/ingest",
        payload: { repo: "acme/app", files: [] },
      })
    ).statusCode;
    const madeUp = await probeCiRoutes(
      server,
      "lore_ci_made_up_stored_token",
      "acme/app",
    );

    expect({
      noBearer,
      madeUp,
      mutations: sqlCalls.filter(isIngestMutationOrStateQuery),
    }).toEqual({
      noBearer: 401,
      madeUp: {
        legacyIngest: 401,
        deltaIngest: 401,
        ingestState: 401,
        impactBase: 401,
        impact: 401,
        specLinksParse: 401,
      },
      mutations: [],
    });
  });

  it("refuses a stored ci token when the repository lookup by numeric id fails", async () => {
    const { server, pool, sqlCalls } = createServerWith({
      repos: [ACME_REPO, OTHER_REPO],
      tokens: BASE_TOKENS,
    });
    const answer = pool.query.getMockImplementation();

    pool.query.mockImplementation((rawSql: string, params?: unknown[]) =>
      String(rawSql).includes("FROM lore.repos WHERE github_id")
        ? Promise.reject(new Error("connection reset"))
        : answer!(rawSql, params),
    );

    const statuses = await probeRepoCiRoutes(server, CI_TOKEN_ACME, "acme/app");

    expect({
      statuses,
      mutations: sqlCalls.filter(isIngestMutationOrStateQuery),
    }).toEqual({
      statuses: {
        legacyIngest: 503,
        deltaIngest: 503,
        ingestState: 503,
        impactBase: 503,
        impact: 503,
      },
      mutations: [],
    });
  });

  it("accepts ingest requests with either the repository's stored ci token or a valid default-branch identity token", async () => {
    const { server } = createServerWith({
      repos: [ACME_REPO, OTHER_REPO],
      tokens: BASE_TOKENS,
    });
    const nowSec = Math.floor(BASE_NOW_MS / 1000);
    const oidcJwt = signJwt({
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
      iat: nowSec - 30,
      nbf: nowSec - 30,
      exp: nowSec + 300,
    });

    const storedLegacy = await postIngest(server, CI_TOKEN_ACME, "acme/app");
    const storedDelta = await postDelta(server, CI_TOKEN_ACME, "acme/app");
    const oidcLegacy = await postIngest(server, oidcJwt, "acme/app");
    const oidcDelta = await postDelta(server, oidcJwt, "acme/app");

    expect({ storedLegacy, storedDelta, oidcLegacy, oidcDelta }).toEqual({
      storedLegacy: 200,
      storedDelta: 200,
      oidcLegacy: 200,
      oidcDelta: 200,
    });
  });
});

async function postIngest(
  server: ReturnType<typeof buildServer>,
  token: string,
  repo: string,
): Promise<number> {
  const res = await server.inject({
    method: "POST",
    url: "/api/ingest",
    headers: { authorization: `Bearer ${token}` },
    payload: { repo, files: [] },
  });

  return res.statusCode;
}

async function postDelta(
  server: ReturnType<typeof buildServer>,
  token: string,
  repo: string,
): Promise<number> {
  const [owner, name] = repo.split("/");
  const res = await server.inject({
    method: "POST",
    url: `/api/repos/${owner}/${name}/ingest`,
    headers: { authorization: `Bearer ${token}` },
    payload: validDeltaPayload(),
  });

  return res.statusCode;
}

async function probeCiRoutes(
  server: ReturnType<typeof buildServer>,
  token: string,
  repo: string,
) {
  const repoStatuses = await probeRepoCiRoutes(server, token, repo);
  const specLinksParse = (
    await server.inject({
      method: "POST",
      url: "/api/spec-links/parse",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        docs: [{ path: "specs/a/spec.md", content: "- **FR-1**: x.\n" }],
      },
    })
  ).statusCode;

  return { ...repoStatuses, specLinksParse };
}

async function probeRepoCiRoutes(
  server: ReturnType<typeof buildServer>,
  token: string,
  repo: string,
) {
  const [owner, name] = repo.split("/");
  const headers = { authorization: `Bearer ${token}` };

  return {
    legacyIngest: (
      await server.inject({
        method: "POST",
        url: "/api/ingest",
        headers,
        payload: { repo, files: [] },
      })
    ).statusCode,
    deltaIngest: (
      await server.inject({
        method: "POST",
        url: `/api/repos/${owner}/${name}/ingest`,
        headers,
        payload: validDeltaPayload(),
      })
    ).statusCode,
    ingestState: (
      await server.inject({
        method: "GET",
        url: `/api/repos/${owner}/${name}/ingest-state?kind=specs`,
        headers,
      })
    ).statusCode,
    impactBase: (
      await server.inject({
        method: "GET",
        url: `/api/repos/${owner}/${name}/impact/base`,
        headers,
      })
    ).statusCode,
    impact: (
      await server.inject({
        method: "POST",
        url: `/api/repos/${owner}/${name}/impact`,
        headers,
        payload: { protocol: 2, files: [], docs: [] },
      })
    ).statusCode,
  };
}

async function probeOtherRoutes(
  server: ReturnType<typeof buildServer>,
  token: string,
) {
  const headers = { authorization: `Bearer ${token}` };

  return {
    memory: (
      await server.inject({
        method: "POST",
        url: "/api/memory",
        headers,
        payload: { key: "k", value: "v" },
      })
    ).statusCode,
    episode: (
      await server.inject({
        method: "POST",
        url: "/api/episode",
        headers,
        payload: { content: "note" },
      })
    ).statusCode,
    chunksPrune: (
      await server.inject({
        method: "POST",
        url: "/api/repos/acme/app/chunks/prune",
        headers,
        payload: { keepFiles: [] },
      })
    ).statusCode,
    settings: (
      await server.inject({
        method: "PUT",
        url: "/api/repos/acme/app/settings",
        headers,
        payload: { team: "platform" },
      })
    ).statusCode,
    task: (
      await server.inject({
        method: "POST",
        url: "/api/task",
        headers,
        payload: { description: "d", target_repo: "acme/app" },
      })
    ).statusCode,
    context: (
      await server.inject({
        method: "POST",
        url: "/api/context",
        headers,
        payload: { query: "q", repo: "acme/app" },
      })
    ).statusCode,
    repos: (
      await server.inject({
        method: "GET",
        url: "/api/repos",
        headers,
      })
    ).statusCode,
    repoStatus: (
      await server.inject({
        method: "GET",
        url: "/api/repo-status?repo=acme/app",
        headers,
      })
    ).statusCode,
    traceSpecs: (
      await server.inject({
        method: "GET",
        url: "/api/repos/acme/app/trace/specs",
        headers,
      })
    ).statusCode,
    tokens: (
      await server.inject({
        method: "GET",
        url: "/api/tokens",
        headers,
      })
    ).statusCode,
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

function createServerWith(options: {
  repos: RepoFixture[];
  tokens: TokenFixture[];
}) {
  const pool = makePool();
  const sqlCalls: string[] = [];

  pool.query.mockImplementation((rawSql: string, params?: unknown[]) => {
    const sql = String(rawSql);

    sqlCalls.push(sql);

    return Promise.resolve({
      rows: queryRowsFor(sql, params, options.repos, options.tokens),
    });
  });
  setPool(pool as never);

  return { server: buildServer(() => pool as never), pool, sqlCalls };
}

function queryRowsFor(
  sql: string,
  params: unknown[] | undefined,
  repos: RepoFixture[],
  tokens: TokenFixture[],
): Array<Record<string, unknown>> {
  if (sql.includes("pipeline.api_tokens")) {
    return tokenRowsFor(sql, params, repos, tokens);
  }

  if (sql.includes("lore.repos")) {
    return repoRowsFor(sql, params, repos);
  }

  return ingestStateRowsFor(sql);
}

function tokenRowsFor(
  sql: string,
  params: unknown[] | undefined,
  repos: RepoFixture[],
  tokens: TokenFixture[],
): Array<Record<string, unknown>> {
  const hash = params?.[0] ? String(params[0]) : "";
  const match = tokens.find((entry) => sha256(entry.token) === hash);

  if (!match) {
    return [];
  }

  const base = toTokenRow(match);

  if (!sql.includes("lore.repos")) {
    return [base];
  }

  return joinedTokenRows(sql, match, base, repos);
}

function joinedTokenRows(
  sql: string,
  token: TokenFixture,
  base: Record<string, unknown>,
  repos: RepoFixture[],
): Array<Record<string, unknown>> {
  const matched = token.github_repo_id
    ? repos.filter((repo) => repo.github_id === token.github_repo_id)
    : [];

  if (matched.length === 0) {
    return /left\s+join/i.test(sql) ? [base] : [];
  }

  return matched.map((repo) => ({ ...base, ...toRepoRow(repo) }));
}

function toTokenRow(token: TokenFixture): Record<string, unknown> {
  return {
    id: token.id,
    scopes: token.scopes,
    kind: token.kind,
    login: null,
    displayName: null,
    avatarUrl: null,
    repos: [],
    github_repo_id: token.github_repo_id,
    githubRepoId: token.github_repo_id,
    startedAt: new Date("2026-11-21T10:00:00Z"),
    expiresAt: null,
  };
}

function repoRowsFor(
  sql: string,
  params: unknown[] | undefined,
  repos: RepoFixture[],
): Array<Record<string, unknown>> {
  if (sql.includes("SELECT team FROM lore.repos")) {
    return [{ team: null }];
  }

  const values = (params ?? []).map(String);

  return repos.filter((repo) => repoMatchesParams(repo, values)).map(toRepoRow);
}

function repoMatchesParams(repo: RepoFixture, values: string[]): boolean {
  if (values.length === 0) {
    return true;
  }

  if (values[0].includes("/")) {
    return repo.full_name.toLowerCase() === values[0].toLowerCase();
  }

  if (repo.github_id === null || repo.github_id !== values[0]) {
    return false;
  }

  return values.length === 1 || repo.owner_id === values[1];
}

function toRepoRow(repo: RepoFixture): Record<string, unknown> {
  return {
    ...repo,
    fullName: repo.full_name,
    defaultBranch: repo.default_branch,
    githubId: repo.github_id,
    ownerId: repo.owner_id,
    repository: repo.full_name,
    repo: repo.full_name,
  };
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

function isIngestMutationOrStateQuery(sql: string): boolean {
  return (
    sql.includes("pipeline.ingest_state") ||
    sql.includes(".chunks") ||
    sql.includes("UPDATE lore.repos")
  );
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
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
