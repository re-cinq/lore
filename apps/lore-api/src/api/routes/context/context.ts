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

// max_tokens defaults to 8000; template/agent_id/cross_repo follow documented behavior.
const ContextQuery = z.object({
  repo: repoFullName.optional(),
  query: z.string().optional(),
  template: z
    .enum(["default", "review", "implementation", "research"])
    .default("default"),
  debug: boolFlag,
  // .max(128000) keeps unbounded chunks from re-opening on agent CR size limit.
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

/** Joins doc/adr/spec chunks until budget exceeded; prevents ~3MB overflow on Agent CR size (#1761). */
async function joinedDocChunksWithinBudget(
  pool: Pool,
  repo: string,
  maxTokens: number,
): Promise<string | null> {
  const schema = await resolveChunkSchemaForRepo(pool, repo);
  const { rows } = await pool.query(
    `SELECT content, content_type, file_path FROM ${schema}.chunks
     WHERE repo = $1 AND content_type IN ('doc', 'adr', 'spec')
     ORDER BY content_type, ingested_at DESC`,
    [repo],
  );
  const maxChars = maxTokens * CHARS_PER_TOKEN;
  const parts: string[] = [];
  let used = 0;

  for (const r of rows as Array<{ content: string }>) {
    const cost = r.content.length + (parts.length > 0 ? SEPARATOR.length : 0);

    if (parts.length > 0 && used + cost > maxChars) {
      break;
    }
    parts.push(r.content);
    used += cost;
  }

  return parts.length > 0 ? parts.join(SEPARATOR) : null;
}

/** Assembled context: text for agents, sections/trace for debug output only. */
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
        if (!(query && pool)) {
          const text =
            repo && pool
              ? await joinedDocChunksWithinBudget(pool, repo, maxTokens)
              : null;

          return h.response({ text });
        }

        // Dgraph is optional; null when LORE_DGRAPH_HTTP is unset.
        const dgraph = createDgraphClient(process.env);
        const crossRepo = await resolveCrossRepo(
          pool,
          repo || undefined,
          crossRepoRequested,
        );
        const result = await assembleContext(pool, query, {
          templateName: template,
          maxTokens,
          repo: repo || undefined,
          agentId,
          crossRepo,
          debug,
          dgraph,
        });

        return h.response({
          text: result.text || null,
          sections: result.sections,
          trace: result.trace,
        });
      } catch (err) {
        return h.response({ error: errorMessage(err) }).code(500);
      }
    },
  };
}
