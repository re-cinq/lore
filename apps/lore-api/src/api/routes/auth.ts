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

const ROUTE_SCOPES: Record<string, TokenScope> = {
  "/api/tasks": "read",
  "/api/task/": "read",
  "/api/context": "read",
  "/api/graph": "read",
  "/api/repo-status": "read",
  "/api/memory": "write",
  "/api/episode": "write",
  "/api/session-summary": "write",
  "/api/task": "task",
  "/api/ingest": "write",
  "/api/onboard": "admin",
  "/api/task-logs": "write",
  "/api/job-run-logs": "read",
  "/api/webhook/github": "webhook",
  "/api/webhook/slack": "webhook",
  "/api/webhook/incident": "webhook",
  "/api/tokens": "admin",
};

// URL patterns that override the prefix-based scope mapping for routes
// that need stronger scope than their generic prefix would imply. Keep
// these explicit so future `/api/repos/:o/:r/...` routes don't silently
// inherit admin scope.
const SCOPE_OVERRIDES: Array<{ re: RegExp; scope: TokenScope; methods?: string[] }> = [
  {
    re: /^\/api\/repos\/[^/]+\/[^/]+\/settings\/dark-factory(\?|$|\/)/,
    scope: "admin",
  },
  // Agent definitions: the runner reads the resolved def (GET → read); editing
  // definitions is admin. Method-specific so a read-scoped task token can resolve.
  {
    re: /^\/api\/repos\/[^/]+\/[^/]+\/agent-definitions(\/[^/?]+)?(\?|$)/,
    scope: "read",
    methods: ["GET"],
  },
  {
    re: /^\/api\/repos\/[^/]+\/[^/]+\/agent-definitions(\/[^/?]+)?(\?|$)/,
    scope: "admin",
    methods: ["POST", "PUT", "DELETE"],
  },
  {
    re: /^\/api\/repos\/[^/]+\/[^/]+\/impact(\?|$|\/)/,
    scope: "write",
  },
  {
    re: /^\/api\/repos\/[^/]+\/[^/]+\/ingest-graph(\?|$|\/)/,
    scope: "write",
  },
  // Webhook: GET status is read; POST .../webhook/ensure creates/repoints (write).
  {
    re: /^\/api\/repos\/[^/]+\/[^/]+\/webhook(\?|$|\/)/,
    scope: "read",
    methods: ["GET"],
  },
  {
    re: /^\/api\/repos\/[^/]+\/[^/]+\/webhook\/ensure(\?|$|\/)/,
    scope: "write",
    methods: ["POST"],
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

/**
 * Validate a per-client token against the DB.
 * Returns the scopes if valid, null if invalid.
 * Falls back to LORE_INGEST_TOKEN (full access) for backward compatibility.
 */
export async function validateClientToken(
  pool: Pool | null,
  bearerToken: string,
  requiredScope: TokenScope,
): Promise<boolean> {
  // Legacy single-token: full access
  const legacyToken = process.env.LORE_INGEST_TOKEN;
  if (legacyToken && bearerToken === legacyToken) return true;

  // Per-client token: check DB
  if (!pool) return false;
  const tokenHash = createHash("sha256").update(bearerToken).digest("hex");
  try {
    const { rows } = await pool.query(
      `UPDATE pipeline.api_tokens SET last_used = now()
       WHERE token_hash = $1 AND revoked_at IS NULL
         AND (expires_at IS NULL OR expires_at > now())
       RETURNING scopes`,
      [tokenHash],
    );
    if (rows.length === 0) return false;
    const scopes: string[] = rows[0].scopes;
    // admin scope grants everything
    if (scopes.includes("admin")) return true;
    return scopes.includes(requiredScope);
  } catch {
    return false;
  }
}
