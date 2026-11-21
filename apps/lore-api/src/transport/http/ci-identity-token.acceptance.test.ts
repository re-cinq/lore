import { createSign, generateKeyPairSync } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makePool } from "@re-cinq/lore-server-core/test-helpers/http-mock.js";
import { buildServer } from "../../app/build-server.js";

const ISSUER = "https://token.actions.githubusercontent.com";
const EVIL_ISSUER = "https://evil.example.com";
const API_URL = "https://lore-api.example";

const originalEnv = { ...process.env };
const originalFetch = globalThis.fetch;

const TRUSTED_KEYS = generateKeyPairSync("rsa", { modulusLength: 2048 });
const ROGUE_KEYS = generateKeyPairSync("rsa", { modulusLength: 2048 });
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

describe("GitHub Actions identity token verification on POST /api/ingest", () => {
  beforeEach(() => {
    currentNowMs = BASE_NOW_MS + testClockStep++ * 120_000;
    vi.useFakeTimers({ now: currentNowMs, toFake: ["Date"] });
    process.env.LORE_API_URL = API_URL;
    delete process.env.GITHUB_HOST;
    installOidcFetch();
  });

  afterEach(() => {
    vi.useRealTimers();
    process.env = { ...originalEnv };
    globalThis.fetch = originalFetch;
  });

  it("accepts a token for ingest only when its issuer is exactly the configured GitHub host issuer", async () => {
    const nowSec = Math.floor(currentNowMs / 1000);
    const server = createServer();
    const exact = await postIngestStatus(server, signJwt(baseClaims(nowSec)));
    const trailingSlash = await postIngestStatus(
      server,
      signJwt({ ...baseClaims(nowSec), iss: `${ISSUER}/` }),
    );
    const otherIssuer = await postIngestStatus(
      server,
      signJwt({ ...baseClaims(nowSec), iss: EVIL_ISSUER }),
    );

    process.env.GITHUB_HOST = "ghe.example.com";

    const mismatchedHost = await postIngestStatus(
      createServer(),
      signJwt(baseClaims(nowSec)),
    );

    expect({
      exact,
      trailingSlash,
      otherIssuer,
      mismatchedHost,
    }).toEqual({
      exact: 200,
      trailingSlash: 401,
      otherIssuer: 401,
      mismatchedHost: 401,
    });
  });

  it("accepts a token only when its signature matches a key published by the issuer key set", async () => {
    const nowSec = Math.floor(currentNowMs / 1000);
    const server = createServer();
    const validJwt = signJwt(baseClaims(nowSec));
    const valid = await postIngestStatus(server, validJwt);
    const wrongKey = await postIngestStatus(
      server,
      signJwt(baseClaims(nowSec), ROGUE_KEYS.privateKey),
    );
    const tampered = await postIngestStatus(
      server,
      tamperPayload(validJwt, {
        ...baseClaims(nowSec),
        repository_id: "9999",
      }),
    );

    expect({ valid, wrongKey, tampered }).toEqual({
      valid: 200,
      wrongKey: 401,
      tampered: 401,
    });
  });

  it("refuses a token whose audience is not this install address", async () => {
    const nowSec = Math.floor(currentNowMs / 1000);
    const server = createServer();
    const { aud: _omitted, ...withoutAud } = baseClaims(nowSec);
    const valid = await postIngestStatus(server, signJwt(baseClaims(nowSec)));
    const wrongAud = await postIngestStatus(
      server,
      signJwt({ ...baseClaims(nowSec), aud: "https://other-install.example" }),
    );
    const missingAud = await postIngestStatus(server, signJwt(withoutAud));

    expect({ valid, wrongAud, missingAud }).toEqual({
      valid: 200,
      wrongAud: 401,
      missingAud: 401,
    });
  });

  it("refuses a token outside its validity period across iat, nbf, and exp", async () => {
    const nowSec = Math.floor(currentNowMs / 1000);
    const server = createServer();
    const valid = await postIngestStatus(server, signJwt(baseClaims(nowSec)));
    const expired = await postIngestStatus(
      server,
      signJwt({ ...baseClaims(nowSec), exp: nowSec - 1 }),
    );
    const beforeNbf = await postIngestStatus(
      server,
      signJwt({ ...baseClaims(nowSec), nbf: nowSec + 60 }),
    );
    const futureIat = await postIngestStatus(
      server,
      signJwt({ ...baseClaims(nowSec), iat: nowSec + 60 }),
    );

    expect({ valid, expired, beforeNbf, futureIat }).toEqual({
      valid: 200,
      expired: 401,
      beforeNbf: 401,
      futureIat: 401,
    });
  });

  it("accepts a token only when repository_id and repository_owner_id match an onboarded repository", async () => {
    const nowSec = Math.floor(currentNowMs / 1000);
    const server = createServer();
    const {
      repository_id: _repoId,
      repository_owner_id: _ownerId,
      ...withoutIds
    } = baseClaims(nowSec);
    const valid = await postIngestStatus(server, signJwt(baseClaims(nowSec)));
    const unknownRepoId = await postIngestStatus(
      server,
      signJwt({ ...baseClaims(nowSec), repository_id: "9999" }),
    );
    const wrongOwnerId = await postIngestStatus(
      server,
      signJwt({ ...baseClaims(nowSec), repository_owner_id: "9999" }),
    );
    const missingIds = await postIngestStatus(server, signJwt(withoutIds));

    expect({
      valid,
      unknownRepoId,
      wrongOwnerId,
      missingIds,
    }).toEqual({
      valid: 200,
      unknownRepoId: 401,
      wrongOwnerId: 401,
      missingIds: 401,
    });
  });
});

function installOidcFetch(): void {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();

    return oidcResponseFor(new URL(url));
  }) as typeof fetch;
}

function oidcResponseFor(parsed: URL): Response {
  const allowedOrigin =
    parsed.origin === ISSUER || parsed.origin === EVIL_ISSUER;

  if (!allowedOrigin) {
    return new Response("not found", { status: 404 });
  }

  if (parsed.pathname === "/.well-known/openid-configuration") {
    return jsonResponse({
      issuer: parsed.origin,
      jwks_uri: `${parsed.origin}/.well-known/jwks`,
    });
  }

  if (isJwksPath(parsed.pathname)) {
    return jsonResponse({ keys: [TRUSTED_JWK] });
  }

  return new Response("not found", { status: 404 });
}

function isJwksPath(pathname: string): boolean {
  return (
    pathname === "/.well-known/jwks" || pathname === "/.well-known/jwks.json"
  );
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
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

async function postIngestStatus(
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
    iat: nowSec - 30,
    nbf: nowSec - 30,
    exp: nowSec + 300,
  };
}

function signJwt(
  claims: Record<string, unknown>,
  privateKey = TRUSTED_KEYS.privateKey,
  kid = "k1",
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

function tamperPayload(jwt: string, claims: Record<string, unknown>): string {
  const [header, , signature] = jwt.split(".");

  return `${header}.${toBase64Url(JSON.stringify(claims))}.${signature}`;
}

function toBase64Url(input: string | Buffer): string {
  return Buffer.from(input).toString("base64url");
}
