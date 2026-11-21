import { createSign, generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { Pool } from "pg";
import {
  verifyIdentityToken,
  verifyIdentityTokenSignature,
} from "./ci-identity-token.js";

const ISSUER = "https://token.actions.githubusercontent.com";
const TRUSTED = generateKeyPairSync("rsa", { modulusLength: 2048 });
const ROGUE = generateKeyPairSync("rsa", { modulusLength: 2048 });
const JWK = { ...TRUSTED.publicKey.export({ format: "jwk" }), kid: "k1" };

const fetchKeys = (async (input: RequestInfo | URL) => {
  const url = new URL(String(input));

  if (url.pathname.endsWith("openid-configuration")) {
    return json({ jwks_uri: `${url.origin}/.well-known/jwks` });
  }

  return json({ keys: [JWK] });
}) as typeof fetch;

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 });
}

function part(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function sign(claims: object, key = TRUSTED.privateKey): string {
  const input = `${part({ alg: "RS256", kid: "k1" })}.${part(claims)}`;
  const sig = createSign("RSA-SHA256")
    .update(input)
    .sign(key)
    .toString("base64url");

  return `${input}.${sig}`;
}

describe("verifyIdentityTokenSignature", () => {
  it("returns claims only when the issuer is exactly the configured GitHub host issuer", async () => {
    const verify = (iss: string, host?: string) =>
      verifyIdentityTokenSignature(sign({ iss }), {
        githubHost: host,
        fetch: fetchKeys,
      });

    expect({
      exact: (await verify(ISSUER))?.iss,
      slash: await verify(`${ISSUER}/`),
      foreign: await verify("https://evil.example.com"),
      hostMismatch: await verify(ISSUER, "ghe.example.com"),
    }).toEqual({
      exact: ISSUER,
      slash: null,
      foreign: null,
      hostMismatch: null,
    });
  });

  it("returns claims only when the signature matches a key of the issuer key set", async () => {
    const good = sign({ iss: ISSUER, repository_id: "1" });
    const [header, , signature] = good.split(".");
    const forged = `${header}.${part({ iss: ISSUER, repository_id: "2" })}.${signature}`;
    const verify = (t: string) =>
      verifyIdentityTokenSignature(t, { fetch: fetchKeys });

    expect({
      good: (await verify(good))?.repository_id,
      rogue: await verify(sign({ iss: ISSUER }, ROGUE.privateKey)),
      forged: await verify(forged),
      garbage: await verify("not-a-jwt"),
    }).toEqual({ good: "1", rogue: null, forged: null, garbage: null });
  });
});

const AUDIENCE = "https://lore-api.example";
const NOW_MS = Date.parse("2026-11-21T12:00:00Z");
const NOW_SEC = Math.floor(NOW_MS / 1000);

function validClaims(): Record<string, unknown> {
  return {
    iss: ISSUER,
    aud: AUDIENCE,
    repository_id: "1001",
    repository_owner_id: "2001",
    iat: NOW_SEC - 30,
    nbf: NOW_SEC - 30,
    exp: NOW_SEC + 300,
  };
}

const onboardedPool = {
  query: async () => ({ rows: [{ id: "r-acme" }] }),
} as unknown as Pool;

function signWithHeader(header: object, claims: object): string {
  const input = `${part(header)}.${part(claims)}`;
  const sig = createSign("RSA-SHA256")
    .update(input)
    .sign(TRUSTED.privateKey)
    .toString("base64url");

  return `${input}.${sig}`;
}

describe("verifyIdentityToken refusals", () => {
  const verify = (
    token: string,
    env: Parameters<typeof verifyIdentityToken>[2] = {},
    pool: Pool = onboardedPool,
  ) =>
    verifyIdentityToken(
      pool,
      token,
      { audience: AUDIENCE, fetch: fetchKeys, ...env },
      NOW_MS,
    ).catch(() => null);

  it("refuses a token whose header names an algorithm other than RS256", async () => {
    const claims = validClaims();
    const unsigned = `${part({ alg: "none", kid: "k1" })}.${part(claims)}.`;

    expect({
      valid: (await verify(sign(claims)))?.repository_id,
      none: await verify(unsigned),
      hs256: await verify(signWithHeader({ alg: "HS256", kid: "k1" }, claims)),
      noKid: await verify(signWithHeader({ alg: "RS256" }, claims)),
    }).toEqual({ valid: "1001", none: null, hs256: null, noKid: null });
  });

  it("refuses when the issuer key set errors, rejects or answers something that is not a key set", async () => {
    const answering =
      (body: string, status = 200) =>
      async () =>
        new Response(body, { status });
    const rejecting = (async () => {
      throw new Error("timeout");
    }) as typeof fetch;
    const token = sign(validClaims());

    expect({
      serverError: await verify(token, {
        fetch: answering("{}", 500) as typeof fetch,
      }),
      rejected: await verify(token, { fetch: rejecting }),
      htmlPage: await verify(token, {
        fetch: answering("<html>") as typeof fetch,
      }),
      noKeys: await verify(token, {
        fetch: answering(
          JSON.stringify({ jwks_uri: "https://x/jwks", keys: "k1" }),
        ) as typeof fetch,
      }),
    }).toEqual({
      serverError: null,
      rejected: null,
      htmlPage: null,
      noKeys: null,
    });
  });

  it("refuses every token when this install's address is not configured", async () => {
    const { aud: _aud, ...withoutAud } = validClaims();

    expect({
      withAud: await verify(sign(validClaims()), { audience: undefined }),
      withoutAud: await verify(sign(withoutAud), { audience: undefined }),
    }).toEqual({ withAud: null, withoutAud: null });
  });

  it("refuses a token whose validity claims are missing or not numbers", async () => {
    const { exp: _exp, ...withoutExp } = validClaims();
    const { iat: _iat, ...withoutIat } = validClaims();
    const { nbf: _nbf, ...withoutNbf } = validClaims();

    expect({
      missingExp: await verify(sign(withoutExp)),
      missingIat: await verify(sign(withoutIat)),
      missingNbf: await verify(sign(withoutNbf)),
      stringExp: await verify(
        sign({ ...validClaims(), exp: String(NOW_SEC + 300) }),
      ),
      stringIat: await verify(sign({ ...validClaims(), iat: "0" })),
      stringNbf: await verify(sign({ ...validClaims(), nbf: "0" })),
    }).toEqual({
      missingExp: null,
      missingIat: null,
      missingNbf: null,
      stringExp: null,
      stringIat: null,
      stringNbf: null,
    });
  });

  it("refuses when the onboarded repository lookup fails or the claims are not strings", async () => {
    const failingPool = {
      query: async () => {
        throw new Error("connection refused");
      },
    } as unknown as Pool;

    expect({
      dbDown: await verify(sign(validClaims()), {}, failingPool),
      numericIds: await verify(
        sign({
          ...validClaims(),
          repository_id: 1001,
          repository_owner_id: 2001,
        }),
      ),
    }).toEqual({ dbDown: null, numericIds: null });
  });
});
