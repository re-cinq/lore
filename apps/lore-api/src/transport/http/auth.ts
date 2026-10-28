// Cross-cutting auth primitives: the in-memory sliding-window rateLimit and per-client token resolution, used by bearer-scope and the healthz handler's own bearer check.

import type { Pool } from "pg";
import { createHash } from "node:crypto";

// ── Rate limiter (in-memory sliding window) ─────────────────────────

export type RateBucket =
  "webhook" | "task" | "embed" | "turns" | "ws" | "wsOpen" | "default";

const RATE_LIMITS: Record<RateBucket, number> = {
  webhook: 30,
  task: 60,
  embed: 1200,
  turns: 300,
  ws: 30,
  wsOpen: 30,
  default: 200,
};

const WINDOW_MS = 60_000;
const MAX_WINDOWS = 20_000;
const SWEEP_EVERY = 1_000;

const windows = new Map<string, number[]>();
let sinceSweep = 0;

export function rateWindowCount(): number {
  return windows.size;
}

export function rateLimit(
  bucket: RateBucket,
  principal = "anonymous",
): boolean {
  const now = Date.now();

  sweepWhenDue(now);
  const timestamps = windowFor(`${bucket}|${principal}`, now);

  if (timestamps.length >= RATE_LIMITS[bucket]) {
    return false;
  }
  timestamps.push(now);

  return true;
}

function sweepWhenDue(now: number): void {
  if (++sinceSweep < SWEEP_EVERY && windows.size < MAX_WINDOWS) {
    return;
  }
  sinceSweep = 0;
  dropIdle(now);
  dropOldest();
}

function windowFor(key: string, now: number): number[] {
  const timestamps = windows.get(key) ?? [];

  windows.delete(key);
  windows.set(key, timestamps);

  while (timestamps.length > 0 && timestamps[0] <= now - WINDOW_MS) {
    timestamps.shift();
  }

  return timestamps;
}

function dropIdle(now: number): void {
  for (const [key, timestamps] of windows) {
    const last = timestamps.at(-1);

    if (last === undefined || last <= now - WINDOW_MS) {
      windows.delete(key);
    }
  }
}

function dropOldest(): void {
  for (const key of windows.keys()) {
    if (windows.size < MAX_WINDOWS) {
      return;
    }
    windows.delete(key);
  }
}

// ── Per-client token auth ───────────────────────────────────────────

export type TokenScope = "read" | "write" | "task" | "webhook" | "admin";

const ALL_SCOPES: TokenScope[] = ["read", "write", "task", "webhook", "admin"];

export interface UserIdentity {
  login: string;
  name: string;
  avatarUrl: string | null;
  repos: string[];
}

/** Who a bearer token speaks for: its scopes, the person when it is a user's web session, and the hash a sign-out revokes it by. */
export interface Principal {
  scopes: TokenScope[];
  user: UserIdentity | null;
  tokenHash: string | null;
}

interface TokenRow {
  scopes: TokenScope[];
  kind?: string;
  login?: string | null;
  displayName?: string | null;
  avatarUrl?: string | null;
  repos?: string[];
}

// Resolves a bearer token to its principal (null if missing/invalid/revoked/expired); the legacy LORE_INGEST_TOKEN resolves to full access, and to no person, without a DB hit.
export async function resolvePrincipal(
  pool: Pool | null,
  bearerToken: string,
): Promise<Principal | null> {
  const legacyToken = process.env.LORE_INGEST_TOKEN;

  if (legacyToken && bearerToken === legacyToken) {
    return { scopes: ALL_SCOPES, user: null, tokenHash: null };
  }

  if (!pool) {
    return null;
  }
  const tokenHash = createHash("sha256").update(bearerToken).digest("hex");

  return lookupPrincipal(pool, tokenHash);
}

// Resolves a bearer token to its granted scopes (null if missing/invalid/revoked/expired).
export async function resolveTokenScopes(
  pool: Pool | null,
  bearerToken: string,
): Promise<TokenScope[] | null> {
  return (await resolvePrincipal(pool, bearerToken))?.scopes ?? null;
}

// One UPDATE…RETURNING so a lookup also stamps last_used
async function lookupPrincipal(
  pool: Pool,
  tokenHash: string,
): Promise<Principal | null> {
  const { rows } = await pool.query<TokenRow>(
    `UPDATE pipeline.api_tokens SET last_used = now()
       WHERE token_hash = $1 AND revoked_at IS NULL
         AND (expires_at IS NULL OR expires_at > now())
       RETURNING scopes, kind, login, display_name AS "displayName",
                 avatar_url AS "avatarUrl", repos`,
    [tokenHash],
  );

  if (rows.length === 0) {
    return null;
  }

  return { scopes: rows[0].scopes, user: userOf(rows[0]), tokenHash };
}

function userOf(row: TokenRow): UserIdentity | null {
  if (row.kind !== "user" || !row.login) {
    return null;
  }

  return {
    login: row.login,
    name: row.displayName ?? row.login,
    avatarUrl: row.avatarUrl ?? null,
    repos: row.repos ?? [],
  };
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
