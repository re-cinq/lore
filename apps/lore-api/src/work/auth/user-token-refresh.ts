// Keeps a person's stored GitHub access token usable: before lore-api calls GitHub as the person it refreshes a token that lapses in under five minutes, with the session's token row locked, and replaces both tokens and both expiries in one transaction (FR-220 to FR-224).

import type { Pool } from "pg";
import { runInTransaction, type PgPool } from "@re-cinq/lore-shared";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { apiError } from "@re-cinq/lore-shared/http/api-error.js";
import {
  USER_SESSION_TOKEN_COLUMNS as COLUMNS,
  USER_SESSION_TOKEN_TABLE as TABLE,
} from "@re-cinq/lore-shared/models/user-session-token.js";
import {
  refreshUserTokenOrRefuse,
  RefreshTokenRefused,
  type GithubTokenPair,
  type TokenRefresh,
} from "../../outbound/github-user-client.js";
import { announceSessionEnded } from "./session-ended.js";
import { decryptTokenPair, encryptTokenPair } from "./token-cipher.js";

export const REFRESH_MARGIN_MS = 5 * 60_000;

interface StoredRow {
  encryptedTokens: string;
  accessTokenExpiresAt: Date | null;
}

const SELECT = `SELECT ${COLUMNS.encryptedTokens} AS "encryptedTokens", ${COLUMNS.accessTokenExpiresAt} AS "accessTokenExpiresAt"
  FROM ${TABLE} WHERE ${COLUMNS.tokenId} = $1`;
/** A session marked ended (its API token revoked) reads as holding no stored token, even while a row remains (FR-015, FR-341). */
const SELECT_LIVE = `${SELECT} AND EXISTS (
  SELECT 1 FROM pipeline.api_tokens WHERE id = $1 AND revoked_at IS NULL)`;
const REPLACE = `UPDATE ${TABLE} SET ${COLUMNS.encryptedTokens} = $2, ${COLUMNS.accessTokenExpiresAt} = $3,
  ${COLUMNS.refreshTokenExpiresAt} = $4, ${COLUMNS.updatedAt} = now() WHERE ${COLUMNS.tokenId} = $1`;

const DELETE = `DELETE FROM ${TABLE} WHERE ${COLUMNS.tokenId} = $1`;

type RefreshCall = (refresh: TokenRefresh) => Promise<GithubTokenPair | null>;

/** The person's access token, refreshed first when it lapses in under five minutes. A refresh GitHub gives no new pair for refuses the request and stores nothing. */
export async function freshAccessToken(
  pool: Pool,
  tokenId: string,
  refresh: RefreshCall = refreshUserTokenOrRefuse,
): Promise<string> {
  const settings = refreshSettings();
  const stored = await readRow(pool, SELECT_LIVE, tokenId);

  if (!isDue(stored)) {
    return accessTokenOf(stored, settings);
  }

  return refreshOrEndSession(pool, tokenId, settings, refresh);
}

class UnknownRefreshOutcome extends Error {}

interface CompleteTokenPair extends GithubTokenPair {
  expiresIn: number;
  refreshToken: string;
  refreshTokenExpiresIn: number;
}

async function refreshOrEndSession(
  pool: Pool,
  tokenId: string,
  settings: RefreshSettings,
  refresh: RefreshCall,
): Promise<string> {
  try {
    return await runInTransaction(pool, (tx) =>
      refreshLocked(tx, tokenId, settings, refresh),
    );
  } catch (error) {
    return endSessionOnTerminalRefresh(pool, tokenId, error);
  }
}

async function endSessionOnTerminalRefresh(
  pool: Pool,
  tokenId: string,
  error: unknown,
): Promise<never> {
  if (error instanceof RefreshTokenRefused) {
    await endSession(pool, tokenId);
    throw apiError(401)(
      "GitHub refused the refresh token; the session has ended",
    );
  }

  if (error instanceof UnknownRefreshOutcome) {
    await endSession(pool, tokenId);
    throw apiError(503)("GitHub gave no new token pair");
  }

  throw error;
}

/** Ends the session and deletes its stored tokens in one transaction on a refused or unknown refresh outcome (FR-226, FR-016, FR-471, FR-472, FR-439). */
async function endSession(pool: Pool, tokenId: string): Promise<void> {
  await runInTransaction(pool, async (tx) => {
    await tx.query(
      `UPDATE pipeline.api_tokens SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL`,
      [tokenId],
    );
    await tx.query(DELETE, [tokenId]);
  });
  announceSessionEnded(tokenId);
}

/** Sign-out takes the lock a refresh of the session holds, waits for it, then leaves no stored token and no live API token (FR-022). */
export async function signOutSession(
  pool: Pool,
  sessionId: string,
  tokenHash: string,
): Promise<void> {
  await runInTransaction(pool, async (tx) => {
    await tx.query(`${SELECT} FOR UPDATE`, [sessionId]);
    await tx.query(DELETE, [sessionId]);
    await tx.query(
      `UPDATE pipeline.api_tokens SET revoked_at = now()
         WHERE token_hash = $1 AND revoked_at IS NULL`,
      [tokenHash],
    );
  });
}

/** Another request may have refreshed while this one waited for the lock: then its pair is the one to use (FR-225). */
async function refreshLocked(
  tx: PgPool,
  tokenId: string,
  settings: RefreshSettings,
  refresh: RefreshCall,
): Promise<string> {
  const locked = await readRow(tx, `${SELECT_LIVE} FOR UPDATE`, tokenId);

  if (!isDue(locked)) {
    return accessTokenOf(locked, settings);
  }

  const pair = await newPairFor(locked, settings, refresh);

  await tx.query(REPLACE, [
    tokenId,
    encryptTokenPair(pair, settings.key),
    lapsesIn(pair.expiresIn),
    lapsesIn(pair.refreshTokenExpiresIn),
  ]);

  return pair.accessToken;
}

async function newPairFor(
  row: StoredRow,
  settings: RefreshSettings,
  refresh: RefreshCall,
): Promise<CompleteTokenPair> {
  const { refreshToken } = decryptTokenPair(row.encryptedTokens, settings.key);
  const pair = await refreshOrRefuseUnreachable(refresh, {
    clientId: settings.clientId,
    clientSecret: settings.clientSecret,
    refreshToken: refreshToken ?? "",
  });

  if (!isCompletePair(pair)) {
    throw new UnknownRefreshOutcome();
  }

  return pair;
}

function refreshOrRefuseUnreachable(
  refresh: RefreshCall,
  request: TokenRefresh,
): Promise<GithubTokenPair | null> {
  return refresh(request).catch((error: unknown) => {
    if (connectionNeverOpened(error)) {
      throw apiError(503)("GitHub could not be reached to refresh the token");
    }

    if (error instanceof RefreshTokenRefused) {
      throw error;
    }

    throw new UnknownRefreshOutcome();
  });
}

const accessTokenOf = (row: StoredRow, { key }: RefreshSettings): string =>
  decryptTokenPair(row.encryptedTokens, key).accessToken;

async function readRow(
  db: Pick<PgPool, "query">,
  sql: string,
  tokenId: string,
): Promise<StoredRow> {
  const { rows } = await db.query<StoredRow>(sql, [tokenId]);

  enforceTrue(rows[0], apiError(401), "the session holds no stored token");

  return rows[0];
}

function isDue(row: StoredRow): boolean {
  const expiresAt = row.accessTokenExpiresAt;

  return !expiresAt || expiresAt.getTime() - Date.now() < REFRESH_MARGIN_MS;
}

function isCompletePair(
  pair: GithubTokenPair | null,
): pair is CompleteTokenPair {
  if (!pair?.accessToken || !pair.refreshToken) {
    return false;
  }

  return (
    isPositiveSeconds(pair.expiresIn) &&
    isPositiveSeconds(pair.refreshTokenExpiresIn)
  );
}

function isPositiveSeconds(seconds: number | undefined): seconds is number {
  return typeof seconds === "number" && seconds > 0;
}

function lapsesIn(seconds: number | undefined): Date | null {
  return seconds === undefined ? null : new Date(Date.now() + seconds * 1000);
}

interface RefreshSettings {
  key: string;
  clientId: string;
  clientSecret: string;
}

function refreshSettings(): RefreshSettings {
  const key = process.env.LORE_USER_TOKEN_ENCRYPTION_KEY;
  const clientId = process.env.GITHUB_APP_CLIENT_ID;
  const clientSecret = process.env.GITHUB_APP_CLIENT_SECRET;

  enforceTrue(
    key && clientId && clientSecret,
    apiError(503),
    "the GitHub App client or the token key is not configured",
  );

  return { key, clientId, clientSecret };
}

const NEVER_CONNECTED = new Set([
  "ECONNREFUSED",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ENETUNREACH",
  "EHOSTUNREACH",
]);

/** The request never reached GitHub: the connection could not be opened (FR-227). */
function connectionNeverOpened(error: unknown): boolean {
  const cause = (error as { cause?: { code?: unknown } } | null)?.cause;

  return error instanceof TypeError && NEVER_CONNECTED.has(String(cause?.code));
}
