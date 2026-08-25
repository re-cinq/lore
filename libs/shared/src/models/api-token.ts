import { z } from "zod";
import type { ColumnMap } from "../lib/row.js";

/**
 * `pipeline.api_tokens` — a scoped bearer token for the Lore API.
 *
 * DDL: `scripts/infra/setup-pipeline-schema.sh`. The table stores a SHA-256
 * `tokenHash`, never the token: the plaintext exists once, at mint time, in the
 * response. Revocation is `revokedAt`, not a delete, so an audited token's
 * history survives it.
 */

export const ApiTokenSchema = z.object({
  id: z.string(),
  name: z.string(),
  tokenHash: z.string(),
  scopes: z.array(z.string()),
  createdBy: z.string(),
  expiresAt: z.date().nullable(),
  revokedAt: z.date().nullable(),
  lastUsed: z.date().nullable(),
  createdAt: z.date(),
});

export type ApiToken = z.infer<typeof ApiTokenSchema>;

export const API_TOKEN_COLUMNS = {
  id: "id",
  name: "name",
  tokenHash: "token_hash",
  scopes: "scopes",
  createdBy: "created_by",
  expiresAt: "expires_at",
  revokedAt: "revoked_at",
  lastUsed: "last_used",
  createdAt: "created_at",
} as const satisfies ColumnMap<ApiToken>;

export const API_TOKEN_TABLE = "pipeline.api_tokens";
