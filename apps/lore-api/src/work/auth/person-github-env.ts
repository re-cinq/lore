import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
// The environment a GitHub adapter reads to act as the signed-in person: their stored access token replaces every App credential, so nothing falls back to the App (FR-175, FR-177).

import type { Pool } from "pg";
import { decryptTokenPair } from "./token-cipher.js";

const SEALED_TOKENS = `SELECT (SELECT encrypted_tokens FROM pipeline.user_session_tokens
                  WHERE token_id = pipeline.api_tokens.id) AS "encryptedTokens"
     FROM pipeline.api_tokens WHERE token_hash = $1`;

export interface Caller {
  person: boolean;
  tokenHash: string | null;
}

/** Undefined when the caller is not a person, so the App stays the actor; a person whose token cannot be read is refused rather than acted for with the App. */
export async function personGithubEnv(
  pool: Pool,
  caller: Caller,
): Promise<NodeJS.ProcessEnv | undefined> {
  if (!caller.person) {
    return undefined;
  }

  const accessToken = await storedAccessToken(pool, caller.tokenHash);

  return {
    ...process.env,
    GITHUB_APP_ID: undefined,
    GITHUB_APP_PRIVATE_KEY: undefined,
    GITHUB_APP_INSTALLATION_ID: undefined,
    GITHUB_TOKEN: accessToken,
  };
}

async function storedAccessToken(
  pool: Pool,
  tokenHash: string | null,
): Promise<string> {
  const key = process.env.LORE_USER_TOKEN_ENCRYPTION_KEY;
  const { rows } = await pool.query<{ encryptedTokens: string | null }>(
    SEALED_TOKENS,
    [tokenHash],
  );
  const sealed = rows[0]?.encryptedTokens;

  enforceTrue(
    !(!key || !sealed),
    Error,
    "the signed-in person's GitHub token is not available",
  );

  return decryptTokenPair(sealed, key).accessToken;
}
