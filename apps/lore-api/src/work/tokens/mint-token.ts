// Mints a bearer token row in pipeline.api_tokens. The raw token is returned once and only its sha256 is stored; both the admin's /api/tokens route and the web sign-in mint through here.

import { createHash, randomBytes } from "node:crypto";
import type { Pool } from "pg";

export interface TokenUser {
  login: string;
  displayName: string;
  avatarUrl: string;
  repos: string[];
}

export interface MintInput {
  name: string;
  scopes: string[];
  createdBy: string;
  expiresAt: Date | null;
  kind?: "service" | "user";
  user?: TokenUser;
}

export interface MintedToken {
  token: string;
  row: { id: string; name: string; scopes: string[]; created_at: string };
}

const INSERT = `INSERT INTO pipeline.api_tokens
  (name, token_hash, scopes, created_by, expires_at, kind, login, display_name, avatar_url, repos)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
  RETURNING id, name, scopes, created_at`;

export const hashToken = (token: string): string =>
  createHash("sha256").update(token).digest("hex");

export async function mintApiToken(
  pool: Pool,
  input: MintInput,
): Promise<MintedToken> {
  const token = `lore_${randomBytes(32).toString("hex")}`;
  const { rows } = await pool.query<MintedToken["row"]>(INSERT, [
    input.name,
    hashToken(token),
    input.scopes,
    input.createdBy,
    input.expiresAt,
    input.kind ?? "service",
    ...userColumns(input.user),
  ]);

  return { token, row: rows[0] };
}

const NO_USER_COLUMNS = [null, null, null, []] as const;

function userColumns(user: TokenUser | undefined) {
  return user
    ? [user.login, user.displayName, user.avatarUrl, user.repos]
    : NO_USER_COLUMNS;
}

export async function revokeTokenByHash(
  pool: Pool,
  tokenHash: string,
): Promise<void> {
  await pool.query(
    `UPDATE pipeline.api_tokens SET revoked_at = now()
       WHERE token_hash = $1 AND revoked_at IS NULL`,
    [tokenHash],
  );
}
