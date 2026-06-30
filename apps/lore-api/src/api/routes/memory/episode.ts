import type { IncomingMessage, ServerResponse } from "node:http";
import type { Pool } from "pg";
import { createHash } from "node:crypto";
import { redactSecrets as sanitizeContent } from "@re-cinq/lore-shared";
import { extractFactsFromEpisode } from "@re-cinq/lore-server-core/features/memory/facts.js";
import { extractAndUpdateGraph } from "@re-cinq/lore-server-core/features/memory/graph.js";
import { json, readBody } from "../http.js";
import { makeGraphLlmCall } from "../helpers.js";

export async function handleEpisode(req: IncomingMessage, res: ServerResponse, pool: Pool | null): Promise<void> {
  const body = await readBody(req);
  try {
    const { content, source, ref, agent_id } = JSON.parse(body);
    if (!content) { json(res, 400, { error: "content required" }); return; }
    const agent = agent_id || 'unknown';
    const safeContent = sanitizeContent(content);
    const contentHash = createHash("sha256").update(safeContent).digest("hex");
    const { rows } = await pool!.query(
      `INSERT INTO memory.episodes (agent_id, content, content_hash, source, ref)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (agent_id, content_hash) DO NOTHING
       RETURNING id`,
      [agent, safeContent, contentHash, source || 'session', ref || null],
    );
    if (rows.length === 0) {
      json(res, 200, { status: "duplicate" });
      return;
    }
    extractFactsFromEpisode(rows[0].id, safeContent, agent, pool!).catch(() => {});
    const gLlm = makeGraphLlmCall(pool);
    if (gLlm) extractAndUpdateGraph(pool!, safeContent, ref || null, rows[0].id, null, gLlm).catch(() => {});
    json(res, 200, { status: "ok", episode_id: rows[0].id });
  } catch (err: any) {
    json(res, 500, { error: err.message });
  }
}
