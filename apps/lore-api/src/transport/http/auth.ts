// Cross-cutting auth primitives: the in-memory sliding-window rateLimit and per-client token resolution, used by bearer-scope and the healthz handler's own bearer check.

import type { Pool } from "pg";
import { createHash } from "node:crypto";
import {
  refreshedRepos,
  repoListDueForRefresh,
} from "../../work/auth/session-repo-refresh.js";
import { makerStillMember } from "../../work/auth/maker-membership.js";
import { verifyIdentityToken } from "./ci-identity-token.js";
import { storedCiPrincipal } from "./stored-ci-principal.js";

// ── Rate limiter (in-memory sliding window) ─────────────────────────

export type RateBucket =
  "webhook" | "task" | "embed" | "ws" | "wsOpen" | "session" | "default";

const RATE_LIMITS: Record<RateBucket, number> = {
  webhook: 30,
  task: 60,
  embed: 1200,
  ws: 30,
  wsOpen: 30,
  // A person's web session: one page render reads many routes, and every tab shares the one token.
  session: 600,
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
  /** The person's GitHub numeric user id, the key of every lock and revocation that concerns them. */
  githubId: number;
  login: string;
  name: string;
  avatarUrl: string | null;
  repos: string[];
  /** When the person signed in, and when that sign-in stops working. */
  startedAt: string;
  expiresAt: string | null;
}

/** Who a bearer token speaks for: its scopes, the person when it is a user's web session, and the hash a sign-out revokes it by. */
export interface Principal {
  scopes: TokenScope[];
  user: UserIdentity | null;
  tokenHash: string | null;
  /** The verified CI run behind an identity token: its repository, the ref it ran on and that repository's default branch; null for every other principal. */
  ciIdentity?: CiIdentity | null;
}

/** What a verified CI identity token says about its run, with the default branch read from the onboarded repository. */
export interface CiIdentity {
  repository: string;
  ref: string;
  defaultBranch: string;
  /** True for a repository's stored CI token, which is bound to the repository and not to a ref. */
  stored?: boolean;
}

interface TokenRow {
  id: string;
  reposRefreshedAt?: Date | null;
  encryptedTokens?: string | null;
  scopes: TokenScope[];
  kind?: string;
  githubRepoId?: string | null;
  login?: string | null;
  displayName?: string | null;
  avatarUrl?: string | null;
  repos?: string[];
  github_id?: string | number | null;
  membership_checked_at?: Date | null;
  startedAt: Date;
  expiresAt: Date | null;
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

  const ciIdentity = await identityOf(pool, bearerToken);

  if (ciIdentity) {
    return { scopes: ["write"], user: null, tokenHash: null, ciIdentity };
  }
  const tokenHash = createHash("sha256").update(bearerToken).digest("hex");

  return lookupPrincipal(pool, tokenHash);
}

// The CI identity a valid identity token (JWT shaped, verified) carries; null for any other bearer.
async function identityOf(
  pool: Pool,
  bearerToken: string,
): Promise<CiIdentity | null> {
  if (bearerToken.split(".").length !== 3) {
    return null;
  }
  const claims = await verifyIdentityToken(pool, bearerToken, {
    githubHost: process.env.GITHUB_HOST,
    audience: process.env.LORE_API_URL,
  });

  if (!claims) {
    return null;
  }

  return {
    repository: String(claims.repository),
    ref: String(claims.ref),
    defaultBranch: await defaultBranchOf(pool, claims),
  };
}

async function defaultBranchOf(
  pool: Pool,
  claims: Record<string, unknown>,
): Promise<string> {
  const { rows } = await pool.query<{ default_branch: string | null }>(
    "SELECT default_branch FROM lore.repos WHERE github_id = $1 AND owner_id = $2 LIMIT 1",
    [claims.repository_id, claims.repository_owner_id],
  );

  // A repository row that records no default branch is taken to use "main".
  return rows[0]?.default_branch ?? "main";
}

// Resolves a bearer token to its granted scopes (null if missing/invalid/revoked/expired).
export async function resolveTokenScopes(
  pool: Pool | null,
  bearerToken: string,
): Promise<TokenScope[] | null> {
  return (await resolvePrincipal(pool, bearerToken))?.scopes ?? null;
}

// One UPDATE…RETURNING so a lookup also stamps last_used
const LOOKUP_PRINCIPAL_SQL = `UPDATE pipeline.api_tokens SET last_used = now()
       WHERE token_hash = $1 AND revoked_at IS NULL
         AND (expires_at IS NULL OR expires_at > now())
       RETURNING id, scopes, kind, login, display_name AS "displayName",
                 avatar_url AS "avatarUrl", repos, github_id, github_repo_id AS "githubRepoId", membership_checked_at,
                 repos_refreshed_at AS "reposRefreshedAt",
                 (SELECT encrypted_tokens FROM pipeline.user_session_tokens
                   WHERE token_id = pipeline.api_tokens.id) AS "encryptedTokens",
                 created_at AS "startedAt", expires_at AS "expiresAt"`;

async function lookupPrincipal(
  pool: Pool,
  tokenHash: string,
): Promise<Principal | null> {
  const { rows } = await pool.query<TokenRow>(LOOKUP_PRINCIPAL_SQL, [
    tokenHash,
  ]);

  if (rows.length === 0) {
    return null;
  }

  return principalFromRow(pool, rows[0], tokenHash);
}

async function principalFromRow(
  pool: Pool,
  row: TokenRow,
  tokenHash: string,
): Promise<Principal | null> {
  if (row.kind === "user" && row.github_id == null) {
    return null;
  }

  if (!(await personIsStillMember(pool, row))) {
    return null;
  }

  if (row.kind === "ci") {
    return storedCiPrincipal(pool, row.githubRepoId, tokenHash);
  }
  const user = await userWithFreshRepos(pool, row);

  return { scopes: row.scopes, user, tokenHash };
}

/** A session or a token a person minted holds only while its person is an active member of the org (FR-236, FR-041, FR-045, FR-046). */
async function personIsStillMember(
  pool: Pool,
  row: TokenRow,
): Promise<boolean> {
  if (row.github_id == null) {
    return true;
  }
  const checkedAt = row.membership_checked_at;
  const fresher = checkedAt && checkedAt > row.startedAt;
  const answeredAt = fresher ? checkedAt : row.startedAt;

  return makerStillMember(pool, {
    githubId: Number(row.github_id),
    login: row.login ?? null,
    answeredAt,
    listRefreshDue:
      row.kind === "user" && repoListDueForRefresh(sessionOf(row)),
  });
}

function sessionOf(row: TokenRow) {
  return {
    id: row.id,
    reposRefreshedAt: row.reposRefreshedAt ?? null,
    encryptedTokens: row.encryptedTokens ?? null,
  };
}

async function userWithFreshRepos(
  pool: Pool,
  row: TokenRow,
): Promise<UserIdentity | null> {
  const user = userOf(row);

  if (user) {
    user.repos = await refreshedRepos(pool, sessionOf(row), user.repos);
  }

  return user;
}

function userOf(row: TokenRow): UserIdentity | null {
  if (row.kind !== "user" || !row.login) {
    return null;
  }

  return {
    githubId: Number(row.github_id),
    login: row.login,
    name: row.displayName ?? row.login,
    avatarUrl: row.avatarUrl ?? null,
    repos: row.repos ?? [],
    ...periodOf(row),
  };
}

function periodOf(row: TokenRow) {
  return {
    startedAt: row.startedAt.toISOString(),
    expiresAt: row.expiresAt?.toISOString() ?? null,
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
