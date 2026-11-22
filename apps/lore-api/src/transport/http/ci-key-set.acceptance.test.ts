import { createSign, generateKeyPairSync } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makePool } from "@re-cinq/lore-server-core/test-helpers/http-mock.js";
import { buildServer } from "../../app/build-server.js";

const GITHUB_COM_ISSUER = "https://token.actions.githubusercontent.com";
const FOREIGN_JWKS = "https://foreign.example.com/.well-known/jwks";
const API_URL = "https://lore-api.example";

const originalEnv = { ...process.env };
const originalFetch = globalThis.fetch;

const KEY_ONE = generateKeyPairSync("rsa", { modulusLength: 2048 });
const KEY_TWO = generateKeyPairSync("rsa", { modulusLength: 2048 });
const KEY_THREE = generateKeyPairSync("rsa", { modulusLength: 2048 });

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

const BASE_NOW_MS = Date.parse("2026-11-21T14:00:00Z");

let testClockStep = 0;
let currentNowMs = BASE_NOW_MS;

describe("GitHub Actions JWKS key-set fetching and caching on POST /api/ingest", () => {
  beforeEach(() => {
    currentNowMs = BASE_NOW_MS + testClockStep++ * 7_200_000;
    vi.useFakeTimers({ now: currentNowMs, toFake: ["Date"] });
    process.env.LORE_API_URL = API_URL;
    delete process.env.GITHUB_HOST;
  });

  afterEach(() => {
    vi.useRealTimers();
    process.env = { ...originalEnv };
    globalThis.fetch = originalFetch;
  });

  it("fetches the key set only from the configured issuer origin", async () => {
    const fetchedUrls: string[] = [];

    installOriginCheckFetch(fetchedUrls);

    const sameOriginStatus = await postIngest(
      createServer(),
      signJwt(
        claimsFor(GITHUB_COM_ISSUER, nowSecAt(0)),
        KEY_ONE.privateKey,
        "k1",
      ),
    );

    process.env.GITHUB_HOST = "ghe-foreign.example.com";

    const foreignStatus = await postIngest(
      createServer(),
      signJwt(
        claimsFor(
          "https://ghe-foreign.example.com/_services/token",
          nowSecAt(0),
        ),
        KEY_ONE.privateKey,
        "k1",
      ),
    );

    process.env.GITHUB_HOST = "ghe-http.example.com";

    const downgradeStatus = await postIngest(
      createServer(),
      signJwt(
        claimsFor("https://ghe-http.example.com/_services/token", nowSecAt(0)),
        KEY_ONE.privateKey,
        "k1",
      ),
    );

    expect({
      sameOriginStatus,
      foreignStatus,
      foreignFetched: fetchedUrls.includes(FOREIGN_JWKS),
      downgradeStatus,
      downgradeFetched: fetchedUrls.includes(
        "http://ghe-http.example.com/.well-known/jwks",
      ),
    }).toEqual({
      sameOriginStatus: 200,
      foreignStatus: 401,
      foreignFetched: false,
      downgradeStatus: 401,
      downgradeFetched: false,
    });
  });

  it("keeps at most one key-set fetch in flight while concurrent requests wait for it", async () => {
    process.env.GITHUB_HOST = "ghe-singleflight.example.com";

    const issuer = "https://ghe-singleflight.example.com/_services/token";
    const started = deferred<void>();
    const gate = deferred<void>();
    const counts = { jwks: 0 };

    installGatedFetch(issuer, {
      counts,
      gate: gate.promise,
      keys: [JWK_ONE],
      onStart: started.resolve,
    });

    const server = createServer();
    let settled = 0;
    const track = (token: string) =>
      postIngest(server, token).then((status) => {
        settled++;

        return status;
      });
    const pending = Promise.all([
      track(signJwt(claimsFor(issuer, nowSecAt(0)), KEY_ONE.privateKey, "k1")),
      track(signJwt(claimsFor(issuer, nowSecAt(0)), KEY_ONE.privateKey, "k1")),
    ]);

    await started.promise;
    await pause(10);

    const inFlightFetches = counts.jwks;
    const settledBeforeResolve = settled;

    gate.resolve();

    const statuses = await pending;

    expect({
      inFlightFetches,
      settledBeforeResolve,
      statuses,
      totalFetches: counts.jwks,
    }).toEqual({
      inFlightFetches: 1,
      settledBeforeResolve: 0,
      statuses: [200, 200],
      totalFetches: 1,
    });
  });

  it("refetches on an unknown key id at most once per minute and refuses keys still missing", async () => {
    process.env.GITHUB_HOST = "ghe-negwindow.example.com";

    const issuer = "https://ghe-negwindow.example.com/_services/token";
    const state = { keys: [JWK_ONE], jwksFetches: 0 };

    installMutableFetch(issuer, state);

    const server = createServer();
    const step = (
      offsetMs: number,
      privateKey: typeof KEY_ONE.privateKey,
      kid: string,
    ) => recordStep(server, issuer, state, { offsetMs, privateKey, kid });
    const steps: Record<string, { status: number; fetches: number }> = {};

    steps.initial = await step(0, KEY_ONE.privateKey, "k1");
    state.keys = [JWK_ONE, JWK_TWO];
    steps.cachedHit = await step(20_000, KEY_ONE.privateKey, "k1");
    steps.withinWindow = await step(20_000, KEY_TWO.privateKey, "k2");
    steps.afterWindowFound = await step(61_000, KEY_TWO.privateKey, "k2");
    steps.stillUnknown = await step(122_000, KEY_THREE.privateKey, "k3");
    steps.cooldownUnknown = await step(140_000, KEY_THREE.privateKey, "k3");

    expect(steps).toEqual({
      initial: { status: 200, fetches: 1 },
      cachedHit: { status: 200, fetches: 1 },
      withinWindow: { status: 401, fetches: 1 },
      afterWindowFound: { status: 200, fetches: 2 },
      stillUnknown: { status: 401, fetches: 3 },
      cooldownUnknown: { status: 401, fetches: 3 },
    });
  });

  it("refuses identity tokens when the key set cannot be fetched", async () => {
    process.env.GITHUB_HOST = "ghe-failure.example.com";

    const issuer = "https://ghe-failure.example.com/_services/token";
    const started = deferred<void>();
    const gate = deferred<void>();
    const state = {
      failing: true,
      jwksFetches: 0,
      gate: gate.promise as Promise<void> | null,
      onStart: started.resolve,
    };

    installFailingFetch(issuer, state);

    const server = createServer();
    const outcomes: Record<string, unknown> = {};

    outcomes.cold = await runConcurrentColdFailure(server, issuer, {
      started: started.promise,
      gate,
      state,
    });
    state.gate = null;
    state.failing = false;
    outcomes.recovered = await recordStep(server, issuer, state, {
      offsetMs: 120_000,
      privateKey: KEY_ONE.privateKey,
      kid: "k1",
    });
    state.failing = true;
    outcomes.cachedWhileDown = await recordStep(server, issuer, state, {
      offsetMs: 120_000 + 30 * 60_000,
      privateKey: KEY_ONE.privateKey,
      kid: "k1",
    });
    outcomes.expiredWhileDown = await recordStep(server, issuer, state, {
      offsetMs: 120_000 + 61 * 60_000,
      privateKey: KEY_ONE.privateKey,
      kid: "k1",
    });

    expect(outcomes).toEqual({
      cold: { statuses: [401, 401], fetches: 1 },
      recovered: { status: 200, fetches: 2 },
      cachedWhileDown: { status: 200, fetches: 2 },
      expiredWhileDown: { status: 401, fetches: 3 },
    });
  });

  it("keeps a key set for at most one hour and respects shorter but not longer cache headers", async () => {
    const defaultCap = await runDefaultOneHourCase();
    const shortened = await runShortCacheHeaderCase();
    const cappedLong = await runLongCacheHeaderCase();

    expect({ defaultCap, shortened, cappedLong }).toEqual({
      defaultCap: {
        initial: 200,
        at59m: 200,
        fetchesAt59m: 1,
        at61mAfterRotation: 401,
        fetchesAt61m: 2,
      },
      shortened: {
        initial: 200,
        at60s: 200,
        fetchesAt60s: 1,
        at121s: 200,
        fetchesAt121s: 2,
      },
      cappedLong: {
        initial: 200,
        at59m: 200,
        fetchesAt59m: 1,
        at61m: 200,
        fetchesAt61m: 2,
      },
    });
  });
});

async function runConcurrentColdFailure(
  server: ReturnType<typeof buildServer>,
  issuer: string,
  options: {
    started: Promise<void>;
    gate: ReturnType<typeof deferred<void>>;
    state: { jwksFetches: number };
  },
) {
  const coldFirst = postAt(server, issuer, {
    offsetMs: 0,
    privateKey: KEY_ONE.privateKey,
    kid: "k1",
  });
  const coldSecond = postAt(server, issuer, {
    offsetMs: 0,
    privateKey: KEY_ONE.privateKey,
    kid: "k1",
  });

  await options.started;
  await pause(10);
  options.gate.resolve();

  const statuses = await Promise.all([coldFirst, coldSecond]);

  return { statuses, fetches: options.state.jwksFetches };
}

async function runDefaultOneHourCase() {
  process.env.GITHUB_HOST = "ghe-ttl-default.example.com";

  const issuer = "https://ghe-ttl-default.example.com/_services/token";
  const state = { keys: [JWK_ONE], jwksFetches: 0 };

  installMutableFetch(issuer, state);

  const server = createServer();
  const initial = await postAt(server, issuer, {
    offsetMs: 0,
    privateKey: KEY_ONE.privateKey,
    kid: "k1",
  });
  const at59m = await postAt(server, issuer, {
    offsetMs: 59 * 60_000,
    privateKey: KEY_ONE.privateKey,
    kid: "k1",
  });
  const fetchesAt59m = state.jwksFetches;

  state.keys = [JWK_TWO];

  const at61mAfterRotation = await postAt(server, issuer, {
    offsetMs: 60 * 60_000 + 1_000,
    privateKey: KEY_ONE.privateKey,
    kid: "k1",
  });

  return {
    initial,
    at59m,
    fetchesAt59m,
    at61mAfterRotation,
    fetchesAt61m: state.jwksFetches,
  };
}

async function runShortCacheHeaderCase() {
  process.env.GITHUB_HOST = "ghe-ttl-short.example.com";

  const issuer = "https://ghe-ttl-short.example.com/_services/token";
  const counts = { jwks: 0 };

  installJwksCacheHeaderFetch(issuer, counts, "public, max-age=120");

  const server = createServer();
  const initial = await postAt(server, issuer, {
    offsetMs: 0,
    privateKey: KEY_ONE.privateKey,
    kid: "k1",
  });
  const at60s = await postAt(server, issuer, {
    offsetMs: 60_000,
    privateKey: KEY_ONE.privateKey,
    kid: "k1",
  });
  const fetchesAt60s = counts.jwks;
  const at121s = await postAt(server, issuer, {
    offsetMs: 121_000,
    privateKey: KEY_ONE.privateKey,
    kid: "k1",
  });

  return {
    initial,
    at60s,
    fetchesAt60s,
    at121s,
    fetchesAt121s: counts.jwks,
  };
}

async function runLongCacheHeaderCase() {
  process.env.GITHUB_HOST = "ghe-ttl-long.example.com";

  const issuer = "https://ghe-ttl-long.example.com/_services/token";
  const counts = { jwks: 0 };

  installBothCacheHeaderFetch(issuer, counts, "max-age=7200");

  const server = createServer();
  const initial = await postAt(server, issuer, {
    offsetMs: 0,
    privateKey: KEY_ONE.privateKey,
    kid: "k1",
  });
  const at59m = await postAt(server, issuer, {
    offsetMs: 59 * 60_000,
    privateKey: KEY_ONE.privateKey,
    kid: "k1",
  });
  const fetchesAt59m = counts.jwks;
  const at61m = await postAt(server, issuer, {
    offsetMs: 60 * 60_000 + 1_000,
    privateKey: KEY_ONE.privateKey,
    kid: "k1",
  });

  return {
    initial,
    at59m,
    fetchesAt59m,
    at61m,
    fetchesAt61m: counts.jwks,
  };
}

function installOriginCheckFetch(fetchedUrls: string[]): void {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const raw = typeof input === "string" ? input : input.toString();

    fetchedUrls.push(raw);

    return originCheckResponse(new URL(raw));
  }) as typeof fetch;
}

function originCheckResponse(parsed: URL): Response {
  if (parsed.pathname.endsWith("/.well-known/openid-configuration")) {
    return jsonResponse({ jwks_uri: jwksUriForHost(parsed.host) });
  }

  if (parsed.href === `${GITHUB_COM_ISSUER}/.well-known/jwks`) {
    return jsonResponse({ keys: [JWK_ONE] });
  }

  if (parsed.href === FOREIGN_JWKS || parsed.protocol === "http:") {
    return jsonResponse({ keys: [JWK_ONE] });
  }

  return new Response("not found", { status: 404 });
}

function jwksUriForHost(host: string): string {
  if (host === "ghe-foreign.example.com") {
    return FOREIGN_JWKS;
  }

  if (host === "ghe-http.example.com") {
    return "http://ghe-http.example.com/.well-known/jwks";
  }

  return `https://${host}/.well-known/jwks`;
}

function installGatedFetch(
  issuer: string,
  options: {
    counts: { jwks: number };
    gate: Promise<void>;
    keys: unknown[];
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

    options.counts.jwks++;
    options.onStart();
    await options.gate;

    return jsonResponse({ keys: options.keys });
  }) as typeof fetch;
}

function installMutableFetch(
  issuer: string,
  state: { keys: unknown[]; jwksFetches: number },
): void {
  const origin = new URL(issuer).origin;

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const parsed = new URL(
      typeof input === "string" ? input : input.toString(),
    );

    if (parsed.href === `${issuer}/.well-known/openid-configuration`) {
      return jsonResponse({ jwks_uri: `${origin}/.well-known/jwks` });
    }

    if (parsed.href === `${origin}/.well-known/jwks`) {
      state.jwksFetches++;

      return jsonResponse({ keys: state.keys });
    }

    return new Response("not found", { status: 404 });
  }) as typeof fetch;
}

function installFailingFetch(
  issuer: string,
  state: {
    failing: boolean;
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
    await awaitGateIfPresent(state.gate);

    return state.failing
      ? new Response("upstream error", { status: 500 })
      : jsonResponse({ keys: [JWK_ONE] });
  }) as typeof fetch;
}

async function awaitGateIfPresent(gate: Promise<void> | null): Promise<void> {
  if (gate) {
    await gate;
  }
}

function installJwksCacheHeaderFetch(
  issuer: string,
  counts: { jwks: number },
  cacheControl: string,
): void {
  const origin = new URL(issuer).origin;

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const parsed = new URL(
      typeof input === "string" ? input : input.toString(),
    );

    if (parsed.href === `${issuer}/.well-known/openid-configuration`) {
      return jsonResponse({ jwks_uri: `${origin}/.well-known/jwks` });
    }

    if (parsed.href === `${origin}/.well-known/jwks`) {
      counts.jwks++;

      return jsonResponse({ keys: [JWK_ONE] }, 200, {
        "cache-control": cacheControl,
      });
    }

    return new Response("not found", { status: 404 });
  }) as typeof fetch;
}

function installBothCacheHeaderFetch(
  issuer: string,
  counts: { jwks: number },
  cacheControl: string,
): void {
  const origin = new URL(issuer).origin;

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const parsed = new URL(
      typeof input === "string" ? input : input.toString(),
    );

    if (parsed.href === `${issuer}/.well-known/openid-configuration`) {
      return jsonResponse({ jwks_uri: `${origin}/.well-known/jwks` }, 200, {
        "cache-control": cacheControl,
      });
    }

    if (parsed.href === `${origin}/.well-known/jwks`) {
      counts.jwks++;

      return jsonResponse({ keys: [JWK_ONE] }, 200, {
        "cache-control": cacheControl,
      });
    }

    return new Response("not found", { status: 404 });
  }) as typeof fetch;
}

function jsonResponse(
  body: unknown,
  status = 200,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...extraHeaders },
  });
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
    matchesOnboardedRepoParams(params)
  ) {
    return [ONBOARDED_REPO_ROW];
  }

  return [];
}

function matchesOnboardedRepoParams(params: unknown[] | undefined): boolean {
  const values = (params ?? []).map(String);

  if (values.length === 0) {
    return true;
  }

  if (!values.includes("1001")) {
    return false;
  }

  return values.length === 1 || values.includes("2001");
}

async function recordStep(
  server: ReturnType<typeof buildServer>,
  issuer: string,
  state: { jwksFetches: number },
  target: {
    offsetMs: number;
    privateKey: ReturnType<typeof generateKeyPairSync>["privateKey"];
    kid: string;
  },
) {
  const status = await postAt(server, issuer, target);

  return { status, fetches: state.jwksFetches };
}

async function postAt(
  server: ReturnType<typeof buildServer>,
  issuer: string,
  target: {
    offsetMs: number;
    privateKey: ReturnType<typeof generateKeyPairSync>["privateKey"];
    kid: string;
  },
): Promise<number> {
  vi.setSystemTime(currentNowMs + target.offsetMs);

  return postIngest(
    server,
    signJwt(
      claimsFor(issuer, nowSecAt(target.offsetMs)),
      target.privateKey,
      target.kid,
    ),
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
