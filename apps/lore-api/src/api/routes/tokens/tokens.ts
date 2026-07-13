import type { Pool } from "pg";
import type { ServerRoute } from "@hapi/hapi";
import { z } from "zod";
import { createHash } from "node:crypto";
import { bearerScope } from "../../../server/plugins/bearer-scope.js";
import { zodValidate } from "../../../server/plugins/zod-validate.js";
import type { TokenScope } from "../auth.js";
import {
  DB_UNAVAILABLE,
  clampedLimit,
  offsetParam,
} from "../common-schemas.js";

interface TokensPostBody {
  action?: string;
  name?: string;
  scopes?: string[];
  expires_in_days?: number;
  token_id?: string;
}

// Paging for the GET list. On a "*" route this also validates the bodyless POST's
// (empty) query, which harmlessly resolves to the defaults.
const TokensQuery = z.object({
  limit: clampedLimit.default(20),
  offset: offsetParam,
});
type TokensQuery = z.infer<typeof TokensQuery>;

export function tokensRoute(getPool: () => Pool | null): ServerRoute {
  return {
    // "*" so an unsupported verb still reaches the handler's 405 (rather than a
    // 404 from an unmatched route). Being multi-method, per-method payload
    // validation doesn't fit hapi's per-route model (a payload schema would also
    // run on the bodyless GET), so the POST branch keeps its residual checks; the
    // body is hapi-parsed rather than hand-parsed (ADR-034 FR6).
    method: "*",
    path: "/api/tokens",
    options: {
      ...bearerScope("admin"),
      validate: { query: zodValidate(TokensQuery) },
    },
    handler: async (request, h) => {
      const pool = getPool();
      if (!pool) return h.response({ error: DB_UNAVAILABLE }).code(503);

      if (request.method.toUpperCase() === "GET") {
        // List active tokens (never return the actual token)
        const { limit, offset } = request.query as unknown as TokensQuery;
        const { rows } = await pool.query(
          `SELECT id, name, scopes, created_by, expires_at, last_used, created_at
           FROM pipeline.api_tokens WHERE revoked_at IS NULL ORDER BY created_at DESC
           LIMIT $1 OFFSET $2`,
          [limit, offset],
        );
        const { rows: countRows } = await pool.query(
          `SELECT count(*)::int as total FROM pipeline.api_tokens WHERE revoked_at IS NULL`,
        );
        return h.response({
          tokens: rows,
          total: countRows[0].total,
          limit,
          offset,
        });
      }

      if (request.method.toUpperCase() === "POST") {
        try {
          const { action, name, scopes, expires_in_days, token_id } =
            (request.payload ?? {}) as TokensPostBody;

          if (action === "revoke" && token_id) {
            await pool.query(
              `UPDATE pipeline.api_tokens SET revoked_at = now() WHERE id = $1`,
              [token_id],
            );
            return h.response({ ok: true });
          }

          // Create new token
          if (!name) return h.response({ error: "name required" }).code(400);
          const { randomBytes } = await import("node:crypto");
          const rawToken = `lore_${randomBytes(32).toString("hex")}`;
          const tokenHash = createHash("sha256").update(rawToken).digest("hex");
          const validScopes: TokenScope[] = [
            "read",
            "write",
            "task",
            "webhook",
            "admin",
          ];
          const resolvedScopes = (scopes || ["read"]).filter((s: string) =>
            validScopes.includes(s as TokenScope),
          );
          const expiresAt = expires_in_days
            ? new Date(Date.now() + expires_in_days * 86400000).toISOString()
            : null;

          const { rows } = await pool.query(
            `INSERT INTO pipeline.api_tokens (name, token_hash, scopes, created_by, expires_at)
             VALUES ($1, $2, $3, $4, $5) RETURNING id, name, scopes, created_at`,
            [name, tokenHash, resolvedScopes, "admin", expiresAt],
          );
          // Return the raw token ONCE — it cannot be retrieved again
          return h
            .response({ ...rows[0], token: rawToken, expires_at: expiresAt })
            .code(201);
        } catch (err: any) {
          return h.response({ error: err.message }).code(500);
        }
      }

      return h.response({ error: "method not allowed" }).code(405);
    },
  };
}
