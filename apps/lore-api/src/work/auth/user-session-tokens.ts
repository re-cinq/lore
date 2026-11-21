// Persists each web session's encrypted GitHub App token pair keyed by its pipeline.api_tokens row.

import type { PgPool } from "@re-cinq/lore-shared";
import {
  USER_SESSION_TOKEN_COLUMNS as COLUMNS,
  USER_SESSION_TOKEN_TABLE as TABLE,
} from "@re-cinq/lore-shared/models/user-session-token.js";

const INSERT = `INSERT INTO ${TABLE} (${COLUMNS.tokenId}, ${COLUMNS.encryptedTokens})
  VALUES ($1, $2)`;

export async function storeUserSessionTokens(
  db: PgPool,
  tokenId: string,
  encryptedTokens: string,
): Promise<void> {
  await db.query(INSERT, [tokenId, encryptedTokens]);
}
