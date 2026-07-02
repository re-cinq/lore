/**
 * Cross-cutting request gating: in-memory rate limiting and per-client
 * bearer-token scope auth. The dispatcher runs these before delegating
 * to any handler.
 */

import type { Pool } from "pg";
import { createHash } from "node:crypto";

// ── Rate limiter (in-memory sliding window) ─────────────────────────

export type RateBucket = "webhook" | "task" | "default";

const RATE_LIMITS: Record<RateBucket, number> = {
  webhook: 30,   // 30/min for webhooks
  task: 60,      // 60/min for task operations
  default: 200,  // 200/min for everything else
};

const windows = new Map<string, number[]>();

export function rateLimit(bucket: RateBucket): boolean {
  const now = Date.now();
  const windowMs = 60_000;
  const key = bucket;
  let timestamps = windows.get(key);
  if (!timestamps) { timestamps = []; windows.set(key, timestamps); }
  // Evict old entries
  while (timestamps.length > 0 && timestamps[0] <= now - windowMs) timestamps.shift();
  if (timestamps.length >= RATE_LIMITS[bucket]) return false;
  timestamps.push(now);
  return true;
}

// ── Per-client token auth ───────────────────────────────────────────

export type TokenScope = "read" | "write" | "task" | "webhook" | "admin";

const ROUTE_SCOPES: Record<string, TokenScope> = {};

// URL patterns that override the prefix-based scope mapping for routes
// that need stronger scope than their generic prefix would imply. Keep
// these explicit so future `/api/repos/:o/:r/...` routes don't silently
// inherit admin scope.
const SCOPE_OVERRIDES: Array<{ re: RegExp; scope: TokenScope; methods?: string[] }> = [
  {
    re: /^\/api\/repos\/[^/]+\/[^/]+\/impact(\?|$|\/)/,
    scope: "write",
  },
  // Feature planning: list/get are read; create/refine/finalize/split and the
  // pod result POST are write. Method-specific so a read token can poll.
  {
    re: /^\/api\/repos\/[^/]+\/[^/]+\/features(\/.*)?(\?|$)/,
    scope: "read",
    methods: ["GET"],
  },
  {
    re: /^\/api\/repos\/[^/]+\/[^/]+\/features(\/.*)?(\?|$)/,
    scope: "write",
    methods: ["POST", "PUT"],
  },
];

export function getRequiredScope(url: string, method = "GET"): TokenScope {
  for (const override of SCOPE_OVERRIDES) {
    if (override.re.test(url) && (!override.methods || override.methods.includes(method))) {
      return override.scope;
    }
  }
  for (const [prefix, scope] of Object.entries(ROUTE_SCOPES)) {
    if (url.startsWith(prefix)) return scope;
  }
  return "read";
}

const ALL_SCOPES: TokenScope[] = ["read", "write", "task", "webhook", "admin"];

/**
 * Resolve a bearer token to its granted scopes, or null when it is
 * missing/invalid/revoked/expired or the lookup fails. The legacy
 * LORE_INGEST_TOKEN resolves to full access (all scopes) without a DB hit.
 * The bearer-scope hapi strategy builds on this; `validateClientToken` wraps it.
 */
export async function resolveTokenScopes(pool: Pool | null, bearerToken: string): Promise<TokenScope[] | null> {
  const legacyToken = process.env.LORE_INGEST_TOKEN;
  if (legacyToken && bearerToken === legacyToken) return ALL_SCOPES;

  if (!pool) return null;
  const tokenHash = createHash("sha256").update(bearerToken).digest("hex");
  try {
    const { rows } = await pool.query(
      `UPDATE pipeline.api_tokens SET last_used = now()
       WHERE token_hash = $1 AND revoked_at IS NULL
         AND (expires_at IS NULL OR expires_at > now())
       RETURNING scopes`,
      [tokenHash],
    );
    if (rows.length === 0) return null;
    return rows[0].scopes as TokenScope[];
  } catch {
    return null;
  }
}

/**
 * Validate a per-client token against the DB for a required scope. Retained for
 * the legacy dispatcher; native routes use the bearer-scope hapi strategy.
 */
export async function validateClientToken(
  pool: Pool | null,
  bearerToken: string,
  requiredScope: TokenScope,
): Promise<boolean> {
  const scopes = await resolveTokenScopes(pool, bearerToken);
  if (!scopes) return false;
  return scopes.includes("admin") || scopes.includes(requiredScope);
}
