import { zodResponse } from "../../http/zod-response.js";
import { errorMessage } from "@re-cinq/lore-shared";
import type { Pool } from "pg";
import type {
  Request,
  ResponseObject,
  ResponseToolkit,
  ServerRoute,
} from "@hapi/hapi";
import { resolveChunkSchemaForRepo } from "@re-cinq/lore-shared/project/chunks/chunk-schema.js";
import {
  ContextBackendSchema,
  storeOf,
} from "@re-cinq/lore-shared/knowledge-backend.js";
import {
  assemblyScope,
  templateAssembly,
} from "../../../work/context/template-assembly.js";
import { builtOrAssembled } from "../../../work/context/built-or-assembled.js";
import { contextBuilderFor } from "../../../work/context/context-builder-deps.js";
import { reportingAssembly } from "./assembly-report.js";
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
  // Unset → the repo's settings.context_backend, then "utopia"; an unknown store is a 400, never a silent Lore read. Only lore-v2 runs the context builder.
  backend: ContextBackendSchema.optional(),
});

type ContextQuery = z.infer<typeof ContextQuery>;

const SEPARATOR = "\n\n---\n\n";
// The same chars-per-token heuristic the assembly engine's truncateText uses.
const CHARS_PER_TOKEN = 4;

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
    handler: (request, h) => serveContext(getPool, request, h),
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

/** Joins doc/adr/spec chunks until budget exceeded; prevents ~3MB overflow on Agent CR size (#1761). */
async function joinedDocChunksWithinBudget(
  pool: Pool,
  repo: string,
  maxTokens: number,
): Promise<string | null> {
  const schema = await resolveChunkSchemaForRepo(pool, repo);
  const { rows } = await pool.query<{ content: string }>(
    `SELECT content, content_type, file_path FROM ${schema}.chunks
     WHERE repo = $1 AND content_type IN ('doc', 'adr', 'spec')
     ORDER BY content_type, ingested_at DESC`,
    [repo],
  );

  return joinWithinBudget(
    rows.map((r) => r.content),
    maxTokens * CHARS_PER_TOKEN,
  );
}

/** Takes chunk contents in order until the next one would not fit; the first is always kept, so a single oversized chunk is still served rather than dropped to nothing. */
function joinWithinBudget(contents: string[], maxChars: number): string | null {
  const parts: string[] = [];
  let used = 0;

  for (const content of contents) {
    const cost = content.length + (parts.length > 0 ? SEPARATOR.length : 0);

    if (parts.length > 0 && used + cost > maxChars) {
      break;
    }
    parts.push(content);
    used += cost;
  }

  return parts.length > 0 ? parts.join(SEPARATOR) : null;
}

/** The block for a query: the context builder's when the request names backend lore-v2 and a model is named for it, else the template assembly (#4090). `text` is nulled when empty rather than served as an empty string: a caller distinguishes "assembled nothing" from "assembled blank", and only the first is worth telling an agent about. */
async function assembledResponse(pool: Pool, q: ContextQuery) {
  const query = q.query as string;
  const result = await builtOrAssembled(
    q.backend === "lore-v2"
      ? contextBuilderFor(pool, builderRequest(q, query))
      : null,
    () => reportedTemplateAssembly(pool, query, q),
  );

  logBuilderState(q, result.builder);

  return {
    text: result.text || null,
    sections: result.sections,
    trace: q.debug ? result.trace : undefined,
  };
}

function builderRequest(q: ContextQuery, query: string) {
  return {
    repo: q.repo ?? "",
    query,
    maxTokens: q.max_tokens,
    agentId: q.agent_id,
    crossRepoRequested: q.cross_repo,
  };
}

/** The template assembly, reported on the `[context] assembled` line. */
async function reportedTemplateAssembly(
  pool: Pool,
  query: string,
  q: ContextQuery,
) {
  const repo = q.repo || undefined;
  const scope = await assemblyScope(pool, repo, storeOf(q.backend));

  return reportingAssembly(
    { backend: scope.backend, repo, template: q.template, query },
    () =>
      templateAssembly(pool, query, {
        ...scope,
        repo,
        template: q.template,
        maxTokens: q.max_tokens,
        agentId: q.agent_id,
        crossRepoRequested: q.cross_repo,
      }),
  );
}

/** Nothing to say when the builder is off: the template assembly's own line already reports the call. */
function logBuilderState(q: ContextQuery, builder: string): void {
  if (builder === "off") {
    return;
  }
  console.log(
    `[context] builder=${builder} repo=${q.repo ?? "-"} query=${JSON.stringify(q.query)}`,
  );
}
