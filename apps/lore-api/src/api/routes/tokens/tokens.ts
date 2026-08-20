import { errorMessage } from "@re-cinq/lore-shared";
import type { Pool } from "pg";
import type { Request, ResponseToolkit, ServerRoute } from "@hapi/hapi";
import { z } from "zod";
import { createHash } from "node:crypto";
import { wireSchema } from "@re-cinq/lore-shared/lib/wire-schema.js";
import {
  ApiTokenSchema,
  API_TOKEN_COLUMNS,
} from "@re-cinq/lore-shared/models/api-token.js";
import { zodResponse } from "../../../server/plugins/zod-response.js";
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

/**
 * The token surface never returns `token_hash` — the plaintext exists once, in
 * the create response, and the hash is not a caller's business. Derived from the
 * model so that omission is a deliberate `pick`, not a column someone forgot.
 */
const TokenListSchema = z.object({
  tokens: z.array(
    wireSchema(
      ApiTokenSchema.pick({
        id: true,
        name: true,
        scopes: true,
        createdBy: true,
        expiresAt: true,
        lastUsed: true,
        createdAt: true,
      }),
      API_TOKEN_COLUMNS,
    ),
  ),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
});

const TokenWriteSchema = z.union([
  z.object({ ok: z.literal(true) }),
  z.object({
    id: z.string(),
    name: z.string(),
    token: z.string(),
    scopes: z.array(z.string()),
    expires_at: z.string().nullable(),
  }),
]);

/**
 * GET lists, POST writes, and each declares its own shape.
 *
 * This was ONE `method: "*"` route, so the generator — which stamps a contract
 * per route and applies it to every verb that route serves — could only declare
 * the union of the two. A generated client then saw `list | acknowledgement` on
 * both verbs and had to narrow a thing it already knew.
 *
 * The wildcard route stays as a FALLBACK, and only for the 405: hapi answers an
 * unmatched verb on a matched path with 404, and "you may not DELETE this" is a
 * better answer than "there is nothing here". It declares no contract, so it
 * contributes no operation to the document.
 *
 * Per-method payload validation is now expressible (it was not, on one route
 * serving a bodyless GET) — deliberately NOT taken here: it would turn the POST
 * handler's residual checks into 400s at the edge, which is a behaviour change
 * and not what splitting the contract is for.
 */
export function tokensRoute(getPool: () => Pool | null): ServerRoute[] {
  const listOptions = zodResponse(
    {
      ...bearerScope("admin"),
      validate: { query: zodValidate(TokensQuery) },
    },
    TokenListSchema,
    {
      name: "TokenList",
      description: "A page of active tokens; the hash is never served",
    },
  );
  const writeOptions = zodResponse(bearerScope("admin"), TokenWriteSchema, {
    name: "TokenWriteResult",
    description:
      "The revoke acknowledgement, or the created token — served once and never again",
    errors: [400],
  });

  return [
    { method: "GET", path: "/api/tokens", options: listOptions, handler },
    { method: "POST", path: "/api/tokens", options: writeOptions, handler },
    {
      // Fallback only — a concrete verb above always wins in hapi.
      method: "*",
      path: "/api/tokens",
      options: bearerScope("admin"),
      handler,
    },
  ];

  async function handler(request: Request, h: ResponseToolkit) {
    const pool = getPool();

    if (!pool) {
      return h.response({ error: DB_UNAVAILABLE }).code(503);
    }

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
        if (!name) {
          return h.response({ error: "name required" }).code(400);
        }
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
      } catch (err) {
        return h.response({ error: errorMessage(err) }).code(500);
      }
    }

    return h.response({ error: "method not allowed" }).code(405);
  }
}
