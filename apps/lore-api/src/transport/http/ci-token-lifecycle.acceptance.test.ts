import { createSign, generateKeyPairSync } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makePool } from "@re-cinq/lore-server-core/test-helpers/http-mock.js";
import { buildServer } from "../../app/build-server.js";

const GITHUB_COM_ISSUER = "https://token.actions.githubusercontent.com";
const API_URL = "https://lore-api.example";

const originalEnv = { ...process.env };
const originalFetch = globalThis.fetch;

const KEY_ONE = generateKeyPairSync("rsa", { modulusLength: 2048 });
const KEY_TWO = generateKeyPairSync("rsa", { modulusLength: 2048 });

const JWK_ONE = {
  ...KEY_ONE.publicKey.export({ format: "jwk" }),
  kid: "k1",
  alg: "RS256",
  use: "sig",
};

const JWK_TWO = {
  ...KEY_TWO.publicKey.export({ format: "jwk" }),
  kid: "k2",
  alg: "RS256",
  use: "sig",
};

const ONBOARDED_REPO_ROW = {
  id: "r-acme",
  owner: "acme",
  name: "app",
  full_name: "acme/app",
  github_id: "1001",
  owner_id: "2001",
  github_repo_id: "1001",
  github_owner_id: "2001",
  repository_id: "1001",
  repository_owner_id: "2001",
};

const BASE_NOW_MS = Date.parse("2026-11-21T16:00:00Z");

let testClockStep = 0;
let currentNowMs = BASE_NOW_MS;

describe("GitHub Actions identity token lifecycle and refusal boundaries", () => {
  beforeEach(() => {
    currentNowMs = BASE_NOW_MS + testClockStep++ * 7_200_000;
    vi.useFakeTimers({ now: currentNowMs, toFake: ["Date"] });
    process.env.LORE_API_URL = API_URL;
    delete process.env.GITHUB_HOST;
    delete process.env.LORE_DGRAPH_HTTP;
  });

  afterEach(() => {
    vi.useRealTimers();
    process.env = { ...originalEnv };
    globalThis.fetch = originalFetch;
  });

  it("keeps the key set for one hour when the cache header is absent or cannot be read", async () => {
    const absent = await measureOneHourFallback("absent", null);
    const nonNumeric = await measureOneHourFallback(
      "non-numeric",
      "max-age=soon",
    );
    const trailingGarbage = await measureOneHourFallback(
      "trailing-garbage",
      "max-age=120abc",
    );
    const sharedOnly = await measureOneHourFallback(
      "shared-only",
      "s-maxage=120",
    );

    const expected = {
      initial: 200,
      at5m: 200,
      fetchesAt5m: 1,
      at59m: 200,
      fetchesAt59m: 1,
      at61mAfterRotation: 401,
      fetchesAt61m: 2,
    };

    expect({ absent, nonNumeric, trailingGarbage, sharedOnly }).toEqual({
      absent: expected,
      nonNumeric: expected,
      trailingGarbage: expected,
      sharedOnly: expected,
    });
  });

  it("withholds acceptance after a key set expires until a fresh key set is fetched", async () => {
    process.env.GITHUB_HOST = "ghe-expiry-gate.example.com";

    const issuer = "https://ghe-expiry-gate.example.com/_services/token";
    const refetchStarted = deferred<void>();
    const refetchGate = deferred<void>();
    const state = {
      keys: [JWK_ONE] as unknown[],
      cacheControl: "max-age=60",
      jwksFetches: 0,
      gate: null as Promise<void> | null,
      onStart: refetchStarted.resolve,
    };

    installControlledFetch(issuer, state);

    const server = createServer();
    const initial = await postIngestAt(server, issuer, 0);
    const gated = await runGatedRefetch(server, issuer, {
      started: refetchStarted.promise,
      gate: refetchGate,
      state,
    });

    state.keys = [JWK_TWO];

    const afterRotation = await postIngestAt(server, issuer, 122_000);

    expect({
      initial,
      ...gated,
      afterRotation,
      fetchesAfterRotation: state.jwksFetches,
    }).toEqual({
      initial: 200,
      fetchesWhilePending: 2,
      settledBeforeRefetch: false,
      afterRefetch: 200,
      afterRotation: 401,
      fetchesAfterRotation: 3,
    });
  });

  it("accepts the same identity token across repeated requests until it expires", async () => {
    const state = {
      keys: [JWK_ONE] as unknown[],
      cacheControl: null as string | null,
      jwksFetches: 0,
      gate: null as Promise<void> | null,
      onStart: () => {},
    };

    installControlledFetch(GITHUB_COM_ISSUER, state);

    const server = createServer();
    const token = signJwt(
      claimsFor(GITHUB_COM_ISSUER, nowSecAt(0)),
      KEY_ONE.privateKey,
      "k1",
    );
    const statuses: Record<string, number> = {};

    vi.setSystemTime(currentNowMs);
    statuses.first = await postIngest(server, token);

    vi.setSystemTime(currentNowMs + 120_000);
    statuses.second = await postIngest(server, token);

    vi.setSystemTime(currentNowMs + 240_000);
    statuses.third = await postIngest(server, token);

    vi.setSystemTime(currentNowMs + 300_000);
    statuses.expired = await postIngest(server, token);

    expect(statuses).toEqual({
      first: 200,
      second: 200,
      third: 200,
      expired: 401,
    });
  });

  it("refuses an identity token from a pull request of a fork", async () => {
    const state = {
      keys: [JWK_ONE] as unknown[],
      cacheControl: null as string | null,
      jwksFetches: 0,
      gate: null as Promise<void> | null,
      onStart: () => {},
    };

    installControlledFetch(GITHUB_COM_ISSUER, state);

    const server = createServer();
    const nowSec = nowSecAt(0);
    const sameRepoPr = await postImpact(
      server,
      signJwt(
        {
          ...claimsFor(GITHUB_COM_ISSUER, nowSec),
          sub: "repo:acme/app:pull_request",
          ref: "refs/pull/42/merge",
          head_ref: "feature",
          base_ref: "main",
          event_name: "pull_request",
        },
        KEY_ONE.privateKey,
        "k1",
      ),
    );
    const pullRequestTarget = await postImpact(
      server,
      signJwt(
        {
          ...claimsFor(GITHUB_COM_ISSUER, nowSec),
          sub: "repo:acme/app:pull_request_target",
          ref: "refs/heads/main",
          head_ref: "feature",
          base_ref: "main",
          event_name: "pull_request_target",
        },
        KEY_ONE.privateKey,
        "k1",
      ),
    );
    const forkRepoPr = await postImpact(
      server,
      signJwt(
        {
          ...claimsFor(GITHUB_COM_ISSUER, nowSec),
          sub: "repo:forker/app:pull_request",
          repository: "forker/app",
          repository_id: "9001",
          repository_owner: "forker",
          repository_owner_id: "9002",
          ref: "refs/pull/42/merge",
          head_ref: "feature",
          base_ref: "main",
          event_name: "pull_request",
        },
        KEY_ONE.privateKey,
        "k1",
      ),
    );

    expect({ sameRepoPr, pullRequestTarget, forkRepoPr }).toEqual({
      sameRepoPr: 200,
      pullRequestTarget: 401,
      forkRepoPr: 401,
    });
  });

  it("refuses a pull_request_target token on the ingest write and writes nothing", async () => {
    const state = {
      keys: [JWK_ONE] as unknown[],
      cacheControl: null as string | null,
      jwksFetches: 0,
      gate: null as Promise<void> | null,
      onStart: () => {},
    };

    installControlledFetch(GITHUB_COM_ISSUER, state);

    const pool = makePool();
    const statements: string[] = [];

    pool.query.mockImplementation((rawSql: string, params?: unknown[]) => {
      statements.push(String(rawSql));

      return Promise.resolve({ rows: queryRepoRows(String(rawSql), params) });
    });

    const server = buildServer(() => pool as never);
    const response = await server.inject({
      method: "POST",
      url: "/api/ingest",
      headers: {
        authorization: `Bearer ${signJwt(
          {
            ...claimsFor(GITHUB_COM_ISSUER, nowSecAt(0)),
            sub: "repo:acme/app:pull_request_target",
            event_name: "pull_request_target",
          },
          KEY_ONE.privateKey,
          "k1",
        )}`,
      },
      payload: {
        files: [{ path: "README.md", content: "# forked" }],
        repo: "acme/app",
      },
    });

    expect({
      status: response.statusCode,
      writes: statements.filter(
        (sql) =>
          /^\s*(INSERT|UPDATE|DELETE)\b/i.test(sql) &&
          !sql.includes("pipeline.api_tokens"),
      ),
    }).toEqual({ status: 401, writes: [] });
  });

  it("issues no longer-lived credential in exchange for an identity token", async () => {
    const state = {
      keys: [JWK_ONE] as unknown[],
      cacheControl: null as string | null,
      jwksFetches: 0,
      gate: null as Promise<void> | null,
      onStart: () => {},
    };

    installControlledFetch(GITHUB_COM_ISSUER, state);

    const server = createServer();
    const token = signJwt(
      claimsFor(GITHUB_COM_ISSUER, nowSecAt(0)),
      KEY_ONE.privateKey,
      "k1",
    );

    const ingestResponse = await server.inject({
      method: "POST",
      url: "/api/ingest",
      headers: { authorization: `Bearer ${token}` },
      payload: { files: [], repo: "acme/app" },
    });
    const tokensResponse = await server.inject({
      method: "POST",
      url: "/api/tokens",
      headers: { authorization: `Bearer ${token}` },
      payload: { name: "exchanged", scopes: ["write"], expires_in_days: 30 },
    });
    const redeemResponse = await server.inject({
      method: "POST",
      url: "/api/auth/redeem",
      headers: { authorization: `Bearer ${token}` },
      payload: { code: token },
    });

    const ingestBody = JSON.parse(ingestResponse.payload) as Record<
      string,
      unknown
    >;
    const credentialKeys = ["token", "credential", "access_token", "session"];

    expect({
      ingestStatus: ingestResponse.statusCode,
      ingestSetsCookie: Boolean(ingestResponse.headers["set-cookie"]),
      ingestHasCredentialKey: credentialKeys.some((key) => key in ingestBody),
      tokensStatus: tokensResponse.statusCode,
      redeemStatus: redeemResponse.statusCode,
    }).toEqual({
      ingestStatus: 200,
      ingestSetsCookie: false,
      ingestHasCredentialKey: false,
      tokensStatus: 403,
      redeemStatus: 401,
    });
  });
});

async function measureOneHourFallback(
  label: string,
  cacheControl: string | null,
) {
  const host = `ghe-fallback-${label}.example.com`;

  process.env.GITHUB_HOST = host;

  const issuer = `https://${host}/_services/token`;
  const state = {
    keys: [JWK_ONE] as unknown[],
    cacheControl,
    jwksFetches: 0,
    gate: null as Promise<void> | null,
    onStart: () => {},
  };

  installControlledFetch(issuer, state);

  const server = createServer();
  const measured: Record<string, number> = {
    initial: await postIngestAt(server, issuer, 0),
    at5m: await postIngestAt(server, issuer, 5 * 60_000),
    fetchesAt5m: state.jwksFetches,
    at59m: await postIngestAt(server, issuer, 59 * 60_000),
    fetchesAt59m: state.jwksFetches,
  };

  state.keys = [JWK_TWO];
  measured.at61mAfterRotation = await postIngestAt(
    server,
    issuer,
    60 * 60_000 + 1_000,
  );
  measured.fetchesAt61m = state.jwksFetches;

  return measured;
}

async function runGatedRefetch(
  server: ReturnType<typeof buildServer>,
  issuer: string,
  options: {
    started: Promise<void>;
    gate: ReturnType<typeof deferred<void>>;
    state: { gate: Promise<void> | null; jwksFetches: number };
  },
) {
  options.state.gate = options.gate.promise;
  vi.setSystemTime(currentNowMs + 61_000);

  let settledWhilePending = false;
  const pendingRequest = postIngest(
    server,
    signJwt(claimsFor(issuer, nowSecAt(61_000)), KEY_ONE.privateKey, "k1"),
  ).then((status) => {
    settledWhilePending = true;

    return status;
  });

  await options.started;
  await pause(10);

  const pendingState = {
    fetchesWhilePending: options.state.jwksFetches,
    settledBeforeRefetch: settledWhilePending,
  };

  options.state.gate = null;
  options.gate.resolve();

  return {
    ...pendingState,
    afterRefetch: await pendingRequest,
  };
}

function createServer() {
  const pool = makePool();

  pool.query.mockImplementation((rawSql: string, params?: unknown[]) =>
    Promise.resolve({ rows: queryRepoRows(String(rawSql), params) }),
  );

  return buildServer(() => pool as never);
}

function queryRepoRows(sql: string, params: unknown[] | undefined): unknown[] {
  if (sql.includes("SELECT team FROM lore.repos")) {
    return [{ team: null }];
  }

  if (
    sql.includes("lore.repos") &&
    /^\s*SELECT\b/i.test(sql) &&
    matchesOnboardedRepo(params)
  ) {
    return [ONBOARDED_REPO_ROW];
  }

  return [];
}

function matchesOnboardedRepo(params: unknown[] | undefined): boolean {
  const values = (params ?? []).map(String);

  if (values.length === 0) {
    return true;
  }

  if (!values.includes("1001")) {
    return false;
  }

  return values.length === 1 || values.includes("2001");
}

function installControlledFetch(
  issuer: string,
  state: {
    keys: unknown[];
    cacheControl: string | null;
    jwksFetches: number;
    gate: Promise<void> | null;
    onStart: () => void;
  },
): void {
  const origin = new URL(issuer).origin;

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const parsed = new URL(
      typeof input === "string" ? input : input.toString(),
    );

    if (parsed.href === `${issuer}/.well-known/openid-configuration`) {
      return jsonResponse({ jwks_uri: `${origin}/.well-known/jwks` });
    }

    if (parsed.href !== `${origin}/.well-known/jwks`) {
      return new Response("not found", { status: 404 });
    }

    state.jwksFetches++;
    state.onStart();

    if (state.gate) {
      await state.gate;
    }

    const headers =
      state.cacheControl === null
        ? undefined
        : { "cache-control": state.cacheControl };

    return jsonResponse({ keys: state.keys }, headers);
  }) as typeof fetch;
}

function jsonResponse(
  body: unknown,
  headers?: Record<string, string>,
): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json", ...headers },
  });
}

async function postIngestAt(
  server: ReturnType<typeof buildServer>,
  issuer: string,
  offsetMs: number,
): Promise<number> {
  vi.setSystemTime(currentNowMs + offsetMs);

  return postIngest(
    server,
    signJwt(claimsFor(issuer, nowSecAt(offsetMs)), KEY_ONE.privateKey, "k1"),
  );
}

async function postIngest(
  server: ReturnType<typeof buildServer>,
  token: string,
): Promise<number> {
  const response = await server.inject({
    method: "POST",
    url: "/api/ingest",
    headers: { authorization: `Bearer ${token}` },
    payload: { files: [], repo: "acme/app" },
  });

  return response.statusCode;
}

async function postImpact(
  server: ReturnType<typeof buildServer>,
  token: string,
): Promise<number> {
  const response = await server.inject({
    method: "POST",
    url: "/api/repos/acme/app/impact",
    headers: { authorization: `Bearer ${token}` },
    payload: { protocol: 2, files: [], docs: [] },
  });

  return response.statusCode;
}

function nowSecAt(offsetMs: number): number {
  return Math.floor((currentNowMs + offsetMs) / 1000);
}

function claimsFor(issuer: string, nowSec: number): Record<string, unknown> {
  return {
    iss: issuer,
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
  };
}

function signJwt(
  claims: Record<string, unknown>,
  privateKey: ReturnType<typeof generateKeyPairSync>["privateKey"],
  kid: string,
): string {
  const header = toBase64Url(JSON.stringify({ alg: "RS256", typ: "JWT", kid }));
  const payload = toBase64Url(JSON.stringify(claims));
  const signingInput = `${header}.${payload}`;
  const signature = createSign("RSA-SHA256")
    .update(signingInput)
    .sign(privateKey)
    .toString("base64url");

  return `${signingInput}.${signature}`;
}

function toBase64Url(input: string | Buffer): string {
  return Buffer.from(input).toString("base64url");
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });

  return { promise, resolve };
}

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
