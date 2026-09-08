import { zodResponse } from "../../http/zod-response.js";
import { errorMessage } from "@re-cinq/lore-shared";
import type { Pool } from "pg";
import type {
  Request,
  ResponseObject,
  ResponseToolkit,
  ServerRoute,
} from "@hapi/hapi";
import { createDgraphClient } from "@re-cinq/lore-shared";
import { resolveChunkSchemaForRepo } from "@re-cinq/lore-shared/project/chunks/chunk-schema.js";
import { assembleContext } from "@re-cinq/lore-server-core/features/context/context-assembly.js";
import { resolveCrossRepo } from "@re-cinq/lore-server-core/features/context/cross-repo.js";
import { z } from "zod";
import { bearerScope } from "../../http/bearer-scope.js";
import { zodValidate } from "../../http/zod-validate.js";
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
  max_tokens: z.coerce // eslint-disable-line re-lint/max-member-chain -- pipeline over a value already in hand
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

/** No-query path: repo chunks within budget, or null when repo/pool is missing. */
async function joinedTextOrNull(
  pool: Pool | null,
  repo: string | undefined,
  maxTokens: number,
): Promise<string | null> {
  return repo && pool
    ? await joinedDocChunksWithinBudget(pool, repo, maxTokens)
    : null;
}

/** Assembled context: text for agents, sections/trace for debug output only. */
const AssembledContextSchema = z.object({
  text: z.string().nullable(),
  sections: z.unknown().optional(),
  trace: z.unknown().optional(),
});

/** Assembles against a query. The Dgraph client is optional — null when LORE_DGRAPH_HTTP is unset, which is the ordinary case outside the central cluster. */
async function assembleForQuery(
  pool: Pool,
  query: string,
  opts: {
    repo?: string;
    template?: string;
    maxTokens?: number;
    agentId?: string;
    debug?: boolean;
    crossRepoRequested: boolean;
  },
): Promise<Awaited<ReturnType<typeof assembleContext>>> {
  const repo = opts.repo || undefined;

  return await assembleContext(pool, query, {
    templateName: opts.template,
    maxTokens: opts.maxTokens,
    repo,
    agentId: opts.agentId,
    crossRepo: await resolveCrossRepo(pool, repo, opts.crossRepoRequested),
    debug: opts.debug,
    dgraph: createDgraphClient(process.env),
  });
}

/** Assembles the token-budgeted context bundle: every source at once, ordered by template, which is what makes it the mandatory first call for an agent. */
/** The assembled bundle. `text` is nulled when empty rather than served as an empty string: a caller distinguishes "assembled nothing" from "assembled blank", and only the first is worth telling an agent about. */
async function assembledResponse(pool: Pool, q: ContextQuery) {
  const result = await assembleForQuery(pool, q.query as string, {
    repo: q.repo,
    template: q.template,
    maxTokens: q.max_tokens,
    agentId: q.agent_id,
    debug: q.debug,
    crossRepoRequested: q.cross_repo,
  });

  return {
    text: result.text || null,
    sections: result.sections,
    trace: result.trace,
  };
}

async function serveContext(
  getPool: () => Pool | null,
  request: Request,
  h: ResponseToolkit,
): Promise<ResponseObject> {
  const pool = getPool();
  const q = request.query as unknown as ContextQuery;

  try {
    // Without a query there is nothing to assemble AGAINST — the repo's stored context is returned as-is.
    if (!(q.query && pool)) {
      return h.response({
        text: await joinedTextOrNull(pool, q.repo, q.max_tokens),
      });
    }

    return h.response(await assembledResponse(pool, q));
  } catch (err) {
    return h.response({ error: errorMessage(err) }).code(500);
  }
}

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
    handler: (request, h) => serveContext(getPool, request, h),
  };
}
