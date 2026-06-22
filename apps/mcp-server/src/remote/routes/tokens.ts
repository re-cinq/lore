import type { IncomingMessage, ServerResponse } from "node:http";
import type { Pool } from "pg";
import { createHash } from "node:crypto";
import { json, readBody } from "./http.js";
import type { TokenScope } from "./auth.js";

export async function handleTokens(req: IncomingMessage, res: ServerResponse, pool: Pool | null): Promise<void> {
  if (!pool) { json(res, 503, { error: "database not available" }); return; }
  const method = req.method || "";

  if (method === "GET") {
    // List active tokens (never return the actual token)
    const { rows } = await pool.query(
      `SELECT id, name, scopes, created_by, expires_at, last_used, created_at
       FROM pipeline.api_tokens WHERE revoked_at IS NULL ORDER BY created_at DESC`,
    );
    json(res, 200, { tokens: rows });
    return;
  }

  if (method === "POST") {
    const body = await readBody(req);
    try {
      const { action, name, scopes, expires_in_days, token_id } = JSON.parse(body);

      if (action === "revoke" && token_id) {
        await pool.query(`UPDATE pipeline.api_tokens SET revoked_at = now() WHERE id = $1`, [token_id]);
        json(res, 200, { ok: true });
        return;
      }

      // Create new token
      if (!name) { json(res, 400, { error: "name required" }); return; }
      const { randomBytes } = await import("node:crypto");
      const rawToken = `lore_${randomBytes(32).toString("hex")}`;
      const tokenHash = createHash("sha256").update(rawToken).digest("hex");
      const validScopes: TokenScope[] = ["read", "write", "task", "webhook", "admin"];
      const resolvedScopes = (scopes || ["read"]).filter((s: string) => validScopes.includes(s as TokenScope));
      const expiresAt = expires_in_days ? new Date(Date.now() + expires_in_days * 86400000).toISOString() : null;

      const { rows } = await pool.query(
        `INSERT INTO pipeline.api_tokens (name, token_hash, scopes, created_by, expires_at)
         VALUES ($1, $2, $3, $4, $5) RETURNING id, name, scopes, created_at`,
        [name, tokenHash, resolvedScopes, "admin", expiresAt],
      );
      // Return the raw token ONCE — it cannot be retrieved again
      json(res, 201, { ...rows[0], token: rawToken, expires_at: expiresAt });
    } catch (err: any) {
      json(res, 500, { error: err.message });
    }
    return;
  }

  json(res, 405, { error: "method not allowed" });
}
