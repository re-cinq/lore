// Fetches the issuer's key set, and only from the issuer's own origin (FR-152).

import type { JsonWebKey } from "node:crypto";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";

export interface Jwk extends JsonWebKey {
  kid?: string;
}

const MAX_TTL_MS = 60 * 60_000;
const NEGATIVE_WINDOW_MS = 60_000;

interface KeySet {
  keys: Jwk[];
  fetchedAt: number;
  expiresAt: number;
}

const DEADLINE_MS = 10_000;

interface Cache {
  kept: Map<string, KeySet>;
  inFlight: Map<string, Promise<KeySet>>;
}

/** One cache per fetch function: the process's own fetch shares one, a stand-in gets its own. */
const caches = new WeakMap<typeof fetch, Cache>();

/** The issuer's key with this id, or undefined; throws when a needed fetch fails (FR-153, FR-154, FR-218, FR-350, FR-351, FR-155). */
export async function findKey(
  issuer: string,
  kid: unknown,
  doFetch: typeof fetch,
  deadlineMs = DEADLINE_MS,
): Promise<Jwk | undefined> {
  const now = Date.now();
  const entry = cacheFor(doFetch).kept.get(issuer);
  const known = entry?.keys.find((jwk) => jwk.kid === kid);

  return entry && answers(entry, known, now)
    ? known
    : (await refresh(issuer, doFetch, deadlineMs)).keys.find(
        (jwk) => jwk.kid === kid,
      );
}

function cacheFor(doFetch: typeof fetch): Cache {
  const cache = caches.get(doFetch) ?? { kept: new Map(), inFlight: new Map() };

  caches.set(doFetch, cache);

  return cache;
}

/** Whether the kept set settles the lookup: still fresh, and either holding the key or inside the negative window. */
function answers(entry: KeySet, known: Jwk | undefined, now: number): boolean {
  return (
    now < entry.expiresAt &&
    (known !== undefined || now - entry.fetchedAt < NEGATIVE_WINDOW_MS)
  );
}

function refresh(
  issuer: string,
  doFetch: typeof fetch,
  deadlineMs: number,
): Promise<KeySet> {
  const { kept, inFlight } = cacheFor(doFetch);
  const pending =
    inFlight.get(issuer) ??
    withDeadline(fetchKeySetWithTtl(issuer, doFetch), deadlineMs)
      .then((set) => {
        kept.set(issuer, set);

        return set;
      })
      .finally(() => inFlight.delete(issuer));

  inFlight.set(issuer, pending);

  return pending;
}

/** The promise's outcome, or a rejection once the deadline passes. */
function withDeadline<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("key set fetch timed out")), ms);
  });

  return Promise.race([work, late]).finally(() => clearTimeout(timer));
}

async function fetchKeySetWithTtl(
  issuer: string,
  doFetch: typeof fetch,
): Promise<KeySet> {
  const config = await getJson(
    doFetch,
    `${issuer}/.well-known/openid-configuration`,
  );
  const jwksUri = issuerOwned(String(config.jwks_uri), issuer);
  const { body, cacheControl } = await getJsonWithHeaders(doFetch, jwksUri);
  const fetchedAt = Date.now();

  return {
    keys: Array.isArray(body.keys) ? (body.keys as Jwk[]) : [],
    fetchedAt,
    expiresAt: fetchedAt + ttlMs(cacheControl),
  };
}

/** One hour, or the header's max-age when that is shorter. */
function ttlMs(cacheControl: string | null): number {
  const maxAge = /max-age=(\d+)/i.exec(cacheControl ?? "");

  return maxAge ? Math.min(MAX_TTL_MS, Number(maxAge[1]) * 1000) : MAX_TTL_MS;
}

/** The keys the configured issuer publishes; throws when the key set cannot be fetched or lives off the issuer's origin. */
export async function fetchKeySet(
  issuer: string,
  doFetch: typeof fetch,
): Promise<Jwk[]> {
  const config = await getJson(
    doFetch,
    `${issuer}/.well-known/openid-configuration`,
  );
  const jwksUri = issuerOwned(String(config.jwks_uri), issuer);
  const set = await getJson(doFetch, jwksUri);

  return Array.isArray(set.keys) ? (set.keys as Jwk[]) : [];
}

function issuerOwned(jwksUri: string, issuer: string): string {
  const uri = new URL(jwksUri);

  enforceTrue(
    !(uri.protocol !== "https:" || uri.origin !== new URL(issuer).origin),
    Error,
    `jwks_uri is not on the issuer origin: ${jwksUri}`,
  );

  return jwksUri;
}

async function getJson(
  doFetch: typeof fetch,
  url: string,
): Promise<Record<string, unknown>> {
  return (await getJsonWithHeaders(doFetch, url)).body;
}

async function getJsonWithHeaders(
  doFetch: typeof fetch,
  url: string,
): Promise<{ body: Record<string, unknown>; cacheControl: string | null }> {
  const response = await doFetch(url, { redirect: "error" });

  if (!response.ok) {
    throw new Error(`GET ${url} failed: ${response.status}`);
  }

  return {
    body: (await response.json()) as Record<string, unknown>,
    cacheControl: response.headers.get("cache-control"),
  };
}
