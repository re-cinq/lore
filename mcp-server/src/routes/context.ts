import type { IncomingMessage, ServerResponse } from "node:http";
import type { Pool } from "pg";
import { assembleContext } from "../context-assembly.js";
import { json } from "./http.js";

export async function handleContext(req: IncomingMessage, res: ServerResponse, pool: Pool | null): Promise<void> {
  const url = new URL(req.url!, "http://localhost");
  const repo = url.searchParams.get("repo");
  const query = url.searchParams.get("query");
  const template = url.searchParams.get("template") || "default";
  const debug = url.searchParams.get("debug") === "1" || url.searchParams.get("debug") === "true";
  try {
    if (query && pool) {
      const result = await assembleContext(pool, query, template, 8000, repo || undefined, undefined, undefined, undefined, debug);
      json(res, 200, { text: result.text || null, sections: result.sections, trace: result.trace });
    } else {
      const parts: string[] = [];
      if (repo && pool) {
        const { rows } = await pool.query(
          `SELECT content, content_type, file_path FROM org_shared.chunks
           WHERE repo = $1 AND content_type IN ('doc', 'adr', 'spec')
           ORDER BY content_type, ingested_at DESC`,
          [repo],
        );
        for (const r of rows) parts.push(r.content);
      }
      json(res, 200, { text: parts.length > 0 ? parts.join("\n\n---\n\n") : null });
    }
  } catch (err: any) {
    json(res, 500, { error: err.message });
  }
}
