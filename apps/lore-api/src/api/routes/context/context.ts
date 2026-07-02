import type { Pool } from "pg";
import type { ServerRoute } from "@hapi/hapi";
import { createDgraphClient } from "@re-cinq/lore-shared";
import { assembleContext } from "@re-cinq/lore-server-core/features/context/context-assembly.js";
import { resolveCrossRepo } from "@re-cinq/lore-server-core/features/context/cross-repo.js";
import { bearerScope } from "../../../server/plugins/bearer-scope.js";

export function contextRoute(getPool: () => Pool | null): ServerRoute {
  return {
    method: "GET",
    path: "/api/context",
    options: bearerScope("read"),
    handler: async (request, h) => {
      const pool = getPool();
      const q = request.query as Record<string, string | undefined>;
      const repo = q.repo ?? null;
      const query = q.query ?? null;
      const template = q.template || "default";
      const debug = q.debug === "1" || q.debug === "true";
      // Honor the optional knobs the MCP tool forwards. Absent/invalid max_tokens
      // keeps the documented 8000 default (the template default must not silently
      // raise it). agent_id scopes memories/facts; cross_repo falls back to the
      // repo's settings flag when not explicitly requested.
      const rawMaxTokens = Number(q.max_tokens);
      const maxTokens = Number.isFinite(rawMaxTokens) && rawMaxTokens > 0 ? rawMaxTokens : 8000;
      const agentId = q.agent_id || undefined;
      const crossRepoRequested = q.cross_repo === "true";
      try {
        if (query && pool) {
          // Fail-soft: null when LORE_DGRAPH_HTTP is unset, so the coupling source
          // degrades to an empty section.
          const dgraph = createDgraphClient(process.env);
          const crossRepo = await resolveCrossRepo(pool, repo || undefined, crossRepoRequested);
          const result = await assembleContext(pool, query, template, maxTokens, repo || undefined, agentId, crossRepo, undefined, debug, dgraph);
          return h.response({ text: result.text || null, sections: result.sections, trace: result.trace });
        }
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
        return h.response({ text: parts.length > 0 ? parts.join("\n\n---\n\n") : null });
      } catch (err: any) {
        return h.response({ error: err.message }).code(500);
      }
    },
  };
}
