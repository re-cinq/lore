// Persists each web session's encrypted GitHub App token pair keyed by its pipeline.api_tokens row.

import type { PgPool } from "@re-cinq/lore-shared";
import {
  USER_SESSION_TOKEN_COLUMNS as COLUMNS,
  USER_SESSION_TOKEN_TABLE as TABLE,
} from "@re-cinq/lore-shared/models/user-session-token.js";

const INSERT = `INSERT INTO ${TABLE} (${COLUMNS.tokenId}, ${COLUMNS.encryptedTokens}, ${COLUMNS.accessTokenExpiresAt}, ${COLUMNS.refreshTokenExpiresAt})
  VALUES ($1, $2, $3, $4)`;

export interface StoredTokens {
  encryptedTokens: string;
  accessTokenExpiresAt: Date | null;
  refreshTokenExpiresAt: Date | null;
}

/** One row holds the sealed pair and the expiry of each token in it (FR-220, FR-221). */
export async function storeUserSessionTokens(
  db: PgPool,
  tokenId: string,
  tokens: StoredTokens,
): Promise<void> {
  await db.query(INSERT, [
    tokenId,
    tokens.encryptedTokens,
    tokens.accessTokenExpiresAt,
    tokens.refreshTokenExpiresAt,
  ]);
}
