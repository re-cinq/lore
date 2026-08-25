import { zodResponse } from "../../../server/plugins/zod-response.js";
import { errorMessage } from "@re-cinq/lore-shared";
import type { Pool } from "pg";
import type { ServerRoute } from "@hapi/hapi";
import { createDgraphClient } from "@re-cinq/lore-shared";
import { resolveChunkSchemaForRepo } from "@re-cinq/lore-shared/project/chunks/chunk-schema.js";
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
  template: z
    .enum(["default", "review", "implementation", "research"])
    .default("default"),
  debug: boolFlag,
  // .max keeps the budget meaningful — an absurd max_tokens (e.g. 1000000)
  // would re-open the unbounded chunk-join this budget exists to close.
  max_tokens: z.coerce
    .number()
    .int()
    .positive()
    .max(128000)
    .catch(8000)
    .default(8000),
  agent_id: z.string().optional(),
  cross_repo: boolFlag,
});

type ContextQuery = z.infer<typeof ContextQuery>;

const SEPARATOR = "\n\n---\n\n";
// The same chars-per-token heuristic the assembly engine's truncateText uses.
const CHARS_PER_TOKEN = 4;

/**
 * Assembled context. `text` is the block an agent is handed; `sections` and
 * `trace` appear only on the debug path, which is why both are optional.
 */
const AssembledContextSchema = z.object({
  text: z.string().nullable(),
  sections: z.unknown().optional(),
  trace: z.unknown().optional(),
});

export function contextRoute(getPool: () => Pool | null): ServerRoute {
  return {
    method: "GET",
    path: "/api/context",
    options: zodResponse(
      {
        ...bearerScope("read"),
        validate: { query: zodValidate(ContextQuery) },
      },
      AssembledContextSchema,
      { name: "AssembledContext", description: "The assembled context block" },
    ),
    handler: async (request, h) => {
      const pool = getPool();
      const {
        repo,
        query,
        template,
        debug,
        max_tokens: maxTokens,
        agent_id: agentId,
        cross_repo: crossRepoRequested,
      } = request.query as unknown as ContextQuery;

      try {
        if (query && pool) {
          // Fail-soft: null when LORE_DGRAPH_HTTP is unset, so the coupling source
          // degrades to an empty section.
          const dgraph = createDgraphClient(process.env);
          const crossRepo = await resolveCrossRepo(
            pool,
            repo || undefined,
            crossRepoRequested,
          );
          const result = await assembleContext(
            pool,
            query,
            template,
            maxTokens,
            repo || undefined,
            agentId,
            crossRepo,
            undefined,
            debug,
            dgraph,
          );

          return h.response({
            text: result.text || null,
            sections: result.sections,
            trace: result.trace,
          });
        }
        const parts: string[] = [];

        if (repo && pool) {
          const schema = await resolveChunkSchemaForRepo(pool, repo);
          const { rows } = await pool.query(
            `SELECT content, content_type, file_path FROM ${schema}.chunks
             WHERE repo = $1 AND content_type IN ('doc', 'adr', 'spec')
             ORDER BY content_type, ingested_at DESC`,
            [repo],
          );
          // The join must honour the token budget too: whole chunks until the
          // next would overflow the char budget. Unbounded, this path
          // returned ~3 MB for a repo — which, injected into an Agent CR's
          // parameters, blew the 2 MiB apiserver limit (2026-07-17).
          const maxChars = maxTokens * CHARS_PER_TOKEN;
          let used = 0;

          for (const r of rows as Array<{ content: string }>) {
            const cost =
              r.content.length + (parts.length > 0 ? SEPARATOR.length : 0);

            if (parts.length > 0 && used + cost > maxChars) {
              break;
            }
            parts.push(r.content);
            used += cost;
          }
        }

        return h.response({
          text: parts.length > 0 ? parts.join(SEPARATOR) : null,
        });
      } catch (err) {
        return h.response({ error: errorMessage(err) }).code(500);
      }
    },
  };
}
