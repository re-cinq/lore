import { z } from "zod";
import type { ColumnMap } from "../../lib/row.js";

/** `pipeline.user_session_tokens` — stores the AES-256-GCM encrypted GitHub App access and refresh token pair for a `user` session in `pipeline.api_tokens`, keyed by `tokenId`. */

export const USER_SESSION_TOKEN_TABLE = "pipeline.user_session_tokens";

export const UserSessionTokenSchema = z.object({
  tokenId: z.string(),
  encryptedTokens: z.string(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type UserSessionToken = z.infer<typeof UserSessionTokenSchema>;

export const USER_SESSION_TOKEN_COLUMNS = {
  tokenId: "token_id",
  encryptedTokens: "encrypted_tokens",
  createdAt: "created_at",
  updatedAt: "updated_at",
} as const satisfies ColumnMap<UserSessionToken>;
