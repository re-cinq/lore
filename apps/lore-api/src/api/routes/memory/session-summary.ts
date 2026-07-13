import type { Pool } from "pg";
import type { ServerRoute } from "@hapi/hapi";
import { createHash } from "node:crypto";
import { z } from "zod";
import { extractFactsFromEpisode } from "@re-cinq/lore-server-core/features/memory/facts.js";
import { extractAndUpdateGraph } from "@re-cinq/lore-server-core/features/memory/graph.js";
import { bearerScope } from "../../../server/plugins/bearer-scope.js";
import { zodValidate } from "../../../server/plugins/zod-validate.js";
import { makeGraphLlmCall } from "../helpers.js";
import { DB_UNAVAILABLE } from "../common-schemas.js";

const SessionSummaryBody = z.object({
  session_log: z.union([
    z.string().min(1),
    z.object({ summary: z.string().optional() }).passthrough(),
  ]),
  repo: z.string().optional(),
  agent_id: z.string().optional(),
});

type SessionSummaryBody = z.infer<typeof SessionSummaryBody>;

export function sessionSummaryRoute(getPool: () => Pool | null): ServerRoute {
  return {
    method: "POST",
    path: "/api/session-summary",
    options: {
      ...bearerScope("write"),
      validate: { payload: zodValidate(SessionSummaryBody) },
    },
    handler: async (request, h) => {
      const pool = getPool();

      try {
        const { session_log, repo, agent_id } =
          request.payload as SessionSummaryBody;

        const summary =
          typeof session_log === "string"
            ? session_log
            : session_log.summary || JSON.stringify(session_log);

        if (!summary || summary.length < 10) {
          return h.response({ status: "skipped", reason: "empty session" });
        }

        const content = `Session in ${repo || "unknown"}\n\n${summary}`;
        const agent = agent_id || "session-hook";
        const contentHash = createHash("sha256").update(content).digest("hex");

        if (!pool) {
          return h.response({ error: DB_UNAVAILABLE }).code(503);
        }

        const { rows } = await pool.query(
          `INSERT INTO memory.episodes (agent_id, content, content_hash, source, ref)
           VALUES ($1, $2, $3, 'session', $4)
           ON CONFLICT (agent_id, content_hash) DO NOTHING
           RETURNING id`,
          [agent, content, contentHash, repo || null],
        );

        if (rows.length === 0) {
          return h.response({ status: "duplicate" });
        }

        extractFactsFromEpisode(rows[0].id, content, agent, pool).catch(
          () => {},
        );
        const gLlm = makeGraphLlmCall(pool);

        if (gLlm) {
          extractAndUpdateGraph(
            pool,
            content,
            repo || null,
            rows[0].id,
            null,
            gLlm,
          ).catch(() => {});
        }

        return h.response({ status: "ok", episode_id: rows[0].id });
      } catch (err: any) {
        return h.response({ error: err.message }).code(500);
      }
    },
  };
}
