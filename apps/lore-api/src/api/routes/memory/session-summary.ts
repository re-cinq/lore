import type { IncomingMessage, ServerResponse } from "node:http";
import type { Pool } from "pg";
import { createHash } from "node:crypto";
import { extractFactsFromEpisode } from "@re-cinq/lore-server-core/features/memory/facts.js";
import { extractAndUpdateGraph } from "@re-cinq/lore-server-core/features/memory/graph.js";
import { json, readBody } from "../http.js";
import { makeGraphLlmCall } from "../helpers.js";

export async function handleSessionSummary(req: IncomingMessage, res: ServerResponse, pool: Pool | null): Promise<void> {
  const body = await readBody(req);
  try {
    const { session_log, repo, agent_id } = JSON.parse(body);
    if (!session_log) { json(res, 400, { error: "required: session_log" }); return; }

    const summary = typeof session_log === "string"
      ? session_log
      : (session_log.summary || JSON.stringify(session_log));

    if (!summary || summary.length < 10) {
      json(res, 200, { status: "skipped", reason: "empty session" });
      return;
    }

    const content = `Session in ${repo || "unknown"}\n\n${summary}`;
    const agent = agent_id || "session-hook";
    const contentHash = createHash("sha256").update(content).digest("hex");

    if (!pool) { json(res, 503, { error: "database not available" }); return; }

    const { rows } = await pool.query(
      `INSERT INTO memory.episodes (agent_id, content, content_hash, source, ref)
       VALUES ($1, $2, $3, 'session', $4)
       ON CONFLICT (agent_id, content_hash) DO NOTHING
       RETURNING id`,
      [agent, content, contentHash, repo || null],
    );

    if (rows.length === 0) {
      json(res, 200, { status: "duplicate" });
      return;
    }

    extractFactsFromEpisode(rows[0].id, content, agent, pool).catch(() => {});
    const gLlm = makeGraphLlmCall(pool);
    if (gLlm) extractAndUpdateGraph(pool, content, repo || null, rows[0].id, null, gLlm).catch(() => {});
    json(res, 200, { status: "ok", episode_id: rows[0].id });
  } catch (err: any) {
    json(res, 500, { error: err.message });
  }
}
