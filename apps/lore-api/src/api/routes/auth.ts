// Cross-cutting auth primitives: the in-memory sliding-window rateLimit and per-client token resolution, used by bearer-scope and the healthz handler's own bearer check.

import type { Pool } from "pg";
import { createHash } from "node:crypto";

// ── Rate limiter (in-memory sliding window) ─────────────────────────

export type RateBucket = "webhook" | "task" | "embed" | "turns" | "default";

const RATE_LIMITS: Record<RateBucket, number> = {
  webhook: 30,
  task: 60,
  embed: 1200,
  turns: 300,
  default: 200,
};

const windows = new Map<string, number[]>();

export function rateLimit(bucket: RateBucket): boolean {
  const now = Date.now();
  const windowMs = 60_000;
  const key = bucket;
  let timestamps = windows.get(key);

  if (!timestamps) {
    timestamps = [];
    windows.set(key, timestamps);
  }

  // Evict old entries
  while (timestamps.length > 0 && timestamps[0] <= now - windowMs) {
    timestamps.shift();
  }

  if (timestamps.length >= RATE_LIMITS[bucket]) {
    return false;
  }
  timestamps.push(now);

  return true;
}

// ── Per-client token auth ───────────────────────────────────────────

export type TokenScope = "read" | "write" | "task" | "webhook" | "admin";

const ALL_SCOPES: TokenScope[] = ["read", "write", "task", "webhook", "admin"];

// Resolves a bearer token to its granted scopes (null if missing/invalid/revoked/expired); the legacy LORE_INGEST_TOKEN resolves to full access without a DB hit.
export async function resolveTokenScopes(
  pool: Pool | null,
  bearerToken: string,
): Promise<TokenScope[] | null> {
  const legacyToken = process.env.LORE_INGEST_TOKEN;

  if (legacyToken && bearerToken === legacyToken) {
    return ALL_SCOPES;
  }

  if (!pool) {
    return null;
  }
  const tokenHash = createHash("sha256").update(bearerToken).digest("hex");

  try {
    const { rows } = await pool.query(
      `UPDATE pipeline.api_tokens SET last_used = now()
       WHERE token_hash = $1 AND revoked_at IS NULL
         AND (expires_at IS NULL OR expires_at > now())
       RETURNING scopes`,
      [tokenHash],
    );

    if (rows.length === 0) {
      return null;
    }

    return rows[0].scopes as TokenScope[];
  } catch {
    return null;
  }
}

// Validates a per-client token against the DB for a required scope; used by healthz's own optional bearer check (guarded routes use the bearer-scope strategy instead).
export async function validateClientToken(
  pool: Pool | null,
  bearerToken: string,
  requiredScope: TokenScope,
): Promise<boolean> {
  const scopes = await resolveTokenScopes(pool, bearerToken);

  if (!scopes) {
    return false;
  }

  return scopes.includes("admin") || scopes.includes(requiredScope);
}
