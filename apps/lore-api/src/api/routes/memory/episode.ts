import type { Pool } from "pg";
import type { ServerRoute } from "@hapi/hapi";
import { createHash } from "node:crypto";
import { redactSecrets as sanitizeContent } from "@re-cinq/lore-shared";
import { extractFactsFromEpisode } from "@re-cinq/lore-server-core/features/memory/facts.js";
import { extractAndUpdateGraph } from "@re-cinq/lore-server-core/features/memory/graph.js";
import { bearerScope } from "../../../server/plugins/bearer-scope.js";
import { rawBody } from "../../../server/raw-body.js";
import { makeGraphLlmCall } from "../helpers.js";

export function episodeRoute(getPool: () => Pool | null): ServerRoute {
  return {
    method: "POST",
    path: "/api/episode",
    options: { ...bearerScope("write"), payload: { parse: false } },
    handler: async (request, h) => {
      const pool = getPool();
      try {
        const { content, source, ref, agent_id } = JSON.parse(rawBody(request));
        if (!content) return h.response({ error: "content required" }).code(400);
        const agent = agent_id || "unknown";
        const safeContent = sanitizeContent(content);
        const contentHash = createHash("sha256").update(safeContent).digest("hex");
        const { rows } = await pool!.query(
          `INSERT INTO memory.episodes (agent_id, content, content_hash, source, ref)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (agent_id, content_hash) DO NOTHING
           RETURNING id`,
          [agent, safeContent, contentHash, source || "session", ref || null],
        );
        if (rows.length === 0) return h.response({ status: "duplicate" });

        extractFactsFromEpisode(rows[0].id, safeContent, agent, pool!).catch(() => {});
        const gLlm = makeGraphLlmCall(pool);
        if (gLlm) extractAndUpdateGraph(pool!, safeContent, ref || null, rows[0].id, null, gLlm).catch(() => {});
        return h.response({ status: "ok", episode_id: rows[0].id });
      } catch (err: any) {
        return h.response({ error: err.message }).code(500);
      }
    },
  };
}
