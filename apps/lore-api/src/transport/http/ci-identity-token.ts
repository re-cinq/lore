// Verifies a GitHub Actions OIDC identity token: issuer and signature (FR-070, FR-151), audience (FR-071), validity period (FR-072) and the onboarded repository its claims name (FR-074).

import type { Pool } from "pg";
import { createPublicKey, createVerify, type JsonWebKey } from "node:crypto";

const GITHUB_COM_ISSUER = "https://token.actions.githubusercontent.com";

export type IdentityTokenClaims = Record<string, unknown> & { iss: string };

export interface IdentityTokenEnv {
  githubHost?: string;
  /** This install's own address; the only audience a token may name (FR-071). */
  audience?: string;
  fetch?: typeof fetch;
}

interface Jwk extends JsonWebKey {
  kid?: string;
}

/** The only issuer lore-api trusts: github.com's, or the configured GitHub Enterprise host's. */
export function expectedIssuer(githubHost?: string): string {
  return githubHost
    ? `https://${githubHost}/_services/token`
    : GITHUB_COM_ISSUER;
}

/** Returns the token's claims when its issuer is the configured one and its RS256 signature matches a key the issuer publishes; null otherwise. */
export async function verifyIdentityTokenSignature(
  token: string,
  env: IdentityTokenEnv = {},
): Promise<IdentityTokenClaims | null> {
  try {
    return await verify(token, env);
  } catch {
    return null;
  }
}

async function verify(
  token: string,
  env: IdentityTokenEnv,
): Promise<IdentityTokenClaims | null> {
  const parts = token.split(".");
  const issuer = expectedIssuer(env.githubHost);

  if (parts.length !== 3 || !trusted(parts, issuer)) {
    return null;
  }
  const keys = await fetchKeys(issuer, env.fetch ?? fetch);
  const kid = decode(parts[0]).kid;

  return keys.some((jwk) => jwk.kid === kid && signedBy(parts, jwk))
    ? (decode(parts[1]) as IdentityTokenClaims)
    : null;
}

function trusted(parts: string[], issuer: string): boolean {
  return decode(parts[0]).alg === "RS256" && decode(parts[1]).iss === issuer;
}

function signedBy(parts: string[], jwk: Jwk): boolean {
  return signatureMatches(`${parts[0]}.${parts[1]}`, parts[2], jwk);
}

function decode(part: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
}

function signatureMatches(input: string, signature: string, jwk: Jwk): boolean {
  const key = createPublicKey({ key: jwk, format: "jwk" });

  return createVerify("RSA-SHA256")
    .update(input)
    .verify(key, Buffer.from(signature, "base64url"));
}

async function fetchKeys(
  issuer: string,
  doFetch: typeof fetch,
): Promise<Jwk[]> {
  const config = await getJson(
    doFetch,
    `${issuer}/.well-known/openid-configuration`,
  );
  const set = await getJson(doFetch, String(config.jwks_uri));

  return Array.isArray(set.keys) ? (set.keys as Jwk[]) : [];
}

async function getJson(
  doFetch: typeof fetch,
  url: string,
): Promise<Record<string, unknown>> {
  const response = await doFetch(url);

  if (!response.ok) {
    throw new Error(`GET ${url} failed: ${response.status}`);
  }

  return (await response.json()) as Record<string, unknown>;
}

/** Whether the token's `aud` names this install and `iat`/`nbf`/`exp` hold at `nowSec` (FR-071, FR-072). */
export function claimsCurrent(
  claims: IdentityTokenClaims,
  audience: string | undefined,
  nowSec: number,
): boolean {
  return (
    addressedTo(claims, audience) &&
    typeof claims.exp === "number" &&
    nowSec < claims.exp &&
    reached(claims.iat, nowSec) &&
    reached(claims.nbf, nowSec)
  );
}

/** Whether a time claim is a number at or before `nowSec`. */
function reached(value: unknown, nowSec: number): boolean {
  return typeof value === "number" && value <= nowSec;
}

function addressedTo(claims: IdentityTokenClaims, audience?: string): boolean {
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];

  return audience !== undefined && aud.includes(audience);
}

/** Whether the claims' `repository_id` and `repository_owner_id` match an onboarded `lore.repos` row (FR-074). */
export async function repositoryOnboarded(
  pool: Pool,
  claims: IdentityTokenClaims,
): Promise<boolean> {
  const { repository_id: repoId, repository_owner_id: ownerId } = claims;

  if (typeof repoId !== "string" || typeof ownerId !== "string") {
    return false;
  }
  const { rows } = await pool.query(
    "SELECT id FROM lore.repos WHERE github_id = $1 AND owner_id = $2 LIMIT 1",
    [repoId, ownerId],
  );

  return rows.length > 0;
}

/** The claims of an identity token that is trusted, addressed to this install, current and from an onboarded repository; null otherwise. */
export async function verifyIdentityToken(
  pool: Pool,
  token: string,
  env: IdentityTokenEnv = {},
  nowMs: number = Date.now(),
): Promise<IdentityTokenClaims | null> {
  const claims = await verifyIdentityTokenSignature(token, env);

  return claims &&
    claimsCurrent(claims, env.audience, Math.floor(nowMs / 1000)) &&
    (await repositoryOnboarded(pool, claims))
    ? claims
    : null;
}
