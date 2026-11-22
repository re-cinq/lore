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
  refreshUserToken,
  type GithubTokenPair,
  type TokenRefresh,
} from "../../outbound/github-user-client.js";
import { decryptTokenPair, encryptTokenPair } from "./token-cipher.js";

export const REFRESH_MARGIN_MS = 5 * 60_000;

interface StoredRow {
  encryptedTokens: string;
  accessTokenExpiresAt: Date | null;
}

const SELECT = `SELECT ${COLUMNS.encryptedTokens} AS "encryptedTokens", ${COLUMNS.accessTokenExpiresAt} AS "accessTokenExpiresAt"
  FROM ${TABLE} WHERE ${COLUMNS.tokenId} = $1`;
const REPLACE = `UPDATE ${TABLE} SET ${COLUMNS.encryptedTokens} = $2, ${COLUMNS.accessTokenExpiresAt} = $3,
  ${COLUMNS.refreshTokenExpiresAt} = $4, ${COLUMNS.updatedAt} = now() WHERE ${COLUMNS.tokenId} = $1`;

type RefreshCall = (refresh: TokenRefresh) => Promise<GithubTokenPair | null>;

/** The person's access token, refreshed first when it lapses in under five minutes. A refresh GitHub gives no new pair for refuses the request and stores nothing. */
export async function freshAccessToken(
  pool: Pool,
  tokenId: string,
  refresh: RefreshCall = refreshUserToken,
): Promise<string> {
  const settings = refreshSettings();
  const stored = await readRow(pool, SELECT, tokenId);

  if (!isDue(stored)) {
    return accessTokenOf(stored, settings);
  }

  return runInTransaction(pool, (tx) =>
    refreshLocked(tx, tokenId, settings, refresh),
  );
}

/** Another request may have refreshed while this one waited for the lock: then its pair is the one to use (FR-225). */
async function refreshLocked(
  tx: PgPool,
  tokenId: string,
  settings: RefreshSettings,
  refresh: RefreshCall,
): Promise<string> {
  const locked = await readRow(tx, `${SELECT} FOR UPDATE`, tokenId);

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
) {
  const { refreshToken } = decryptTokenPair(row.encryptedTokens, settings.key);
  const pair = await refresh({
    clientId: settings.clientId,
    clientSecret: settings.clientSecret,
    refreshToken: refreshToken ?? "",
  });

  enforceTrue(
    isCompletePair(pair),
    apiError(503),
    "GitHub gave no new token pair",
  );

  return pair;
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
): pair is GithubTokenPair & { expiresIn: number; refreshToken: string } {
  return Boolean(pair?.expiresIn && pair.refreshToken);
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
