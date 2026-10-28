import { z } from "zod";
import type { ColumnMap } from "../../lib/row.js";

/** `pipeline.api_tokens` — a scoped bearer token for the Lore API; stores a SHA-256 `tokenHash` only, and revocation is `revokedAt` (not a delete) so an audited token's history survives it. A `user` token is one person's web session: it carries their login, name, avatar and the org repos they can read. */

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
  kind: z.enum(["service", "user"]),
  login: z.string().nullable(),
  displayName: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  repos: z.array(z.string()),
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
  kind: "kind",
  login: "login",
  displayName: "display_name",
  avatarUrl: "avatar_url",
  repos: "repos",
} as const satisfies ColumnMap<ApiToken>;

export const API_TOKEN_TABLE = "pipeline.api_tokens";
