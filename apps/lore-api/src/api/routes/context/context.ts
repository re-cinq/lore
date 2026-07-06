import type { Pool } from "pg";
import type { ServerRoute } from "@hapi/hapi";
import { createDgraphClient } from "@re-cinq/lore-shared";
import { assembleContext } from "@re-cinq/lore-server-core/features/context/context-assembly.js";
import { resolveCrossRepo } from "@re-cinq/lore-server-core/features/context/cross-repo.js";
import { z } from "zod";
import { bearerScope } from "../../../server/plugins/bearer-scope.js";
import { zodValidate } from "../../../server/plugins/zod-validate.js";
import { repoFullName, boolFlag } from "../common-schemas.js";

// Absent/invalid max_tokens keeps the documented 8000 default (the template
// default must not silently raise it). template is the closed set of shipped YAML
// templates; agent_id scopes memories/facts; cross_repo falls back to the repo's
// settings flag when not explicitly requested.
const ContextQuery = z.object({
  repo: repoFullName.optional(),
  query: z.string().optional(),
  template: z.enum(["default", "review", "implementation", "research"]).default("default"),
  debug: boolFlag,
  max_tokens: z.coerce.number().int().positive().catch(8000).default(8000),
  agent_id: z.string().optional(),
  cross_repo: boolFlag,
});
type ContextQuery = z.infer<typeof ContextQuery>;

export function contextRoute(getPool: () => Pool | null): ServerRoute {
  return {
    method: "GET",
    path: "/api/context",
    options: { ...bearerScope("read"), validate: { query: zodValidate(ContextQuery) } },
    handler: async (request, h) => {
      const pool = getPool();
      const { repo, query, template, debug, max_tokens: maxTokens, agent_id: agentId, cross_repo: crossRepoRequested } = request.query as unknown as ContextQuery;
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
