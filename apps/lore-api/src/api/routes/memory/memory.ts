import { zodResponse } from "../../../server/plugins/zod-response.js";
import { errorMessage } from "@re-cinq/lore-shared";
import type { Pool } from "pg";
import type { ServerRoute } from "@hapi/hapi";
import { z } from "zod";
import { getQueryEmbedding } from "@re-cinq/lore-server-core/platform/db.js";
import {
  isMemoryDbAvailable,
  writeMemory,
  readMemory,
  deleteMemory,
  listMemories,
} from "@re-cinq/lore-server-core/features/memory/memory.js";
import {
  writeMemoryFile,
  readMemoryFile,
  deleteMemoryFile,
  listMemoriesFile,
  searchMemoryFile,
} from "@re-cinq/lore-server-core/features/memory/memory-file.js";
import { searchMemories } from "@re-cinq/lore-server-core/features/memory/memory-search.js";
import { resolveAgentId } from "@re-cinq/lore-server-core/platform/agent-id.js";
import { extractFactsForMemory } from "../../../features/memory/fact-extraction.js";
import { bearerScope } from "../../../server/plugins/bearer-scope.js";
import { zodValidate } from "../../../server/plugins/zod-validate.js";
import { MAX_PAGE_LIMIT } from "../common-schemas.js";
import { wireSchema } from "@re-cinq/lore-shared/lib/wire-schema.js";
import {
  MemoryEntrySchema,
  MEMORY_ENTRY_COLUMNS,
} from "@re-cinq/lore-shared/models/memory-entry.js";

const version = z.union([z.string(), z.number()]).optional();
// Non-coerced (unlike common-schemas' clampedLimit/offsetParam) — a stringy limit/offset in this JSON body is malformed.
const listLimit = z
  .number()
  .int()
  .positive()
  .transform((n) => Math.min(n, MAX_PAGE_LIMIT))
  .default(50);
const listOffset = z.number().int().min(0).default(0);
const MemoryBody = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("write"),
    key: z.string(),
    value: z.string(),
    agent_id: z.string().optional(),
    ttl: z.number().optional(),
    repo: z.string().optional(),
    extract_facts: z.boolean().default(false),
  }),
  z.object({
    action: z.literal("read"),
    key: z.string(),
    agent_id: z.string().optional(),
    version,
  }),
  z.object({
    action: z.literal("search"),
    query: z.string(),
    agent_id: z.string().optional(),
    pool_name: z.string().optional(),
    limit: z.number().optional(),
    // Carried from lore_search_memory, which has no pool of its own to honor them with (ADR-032).
    include_invalidated: z.boolean().default(false),
    graph_augment: z.boolean().default(false),
  }),
  z.object({
    action: z.literal("delete"),
    key: z.string(),
    agent_id: z.string().optional(),
  }),
  z.object({
    action: z.literal("list"),
    agent_id: z.string().optional(),
    limit: listLimit,
    offset: listOffset,
  }),
]);

type MemoryBody = z.infer<typeof MemoryBody>;

const MemoryVersionSchema = z.object({
  version: z.number(),
  value: z.string(),
  created_at: z.string(),
});

// Pool path's projection: `created_at` restated as the wire STRING (model types it as a pre-serialization `Date`).
const MemoryListEntrySchema = wireSchema(
  MemoryEntrySchema.pick({
    key: true,
    agentId: true,
    repo: true,
    version: true,
    ttlSeconds: true,
  }),
  MEMORY_ENTRY_COLUMNS,
).extend({
  created_at: z.string(),
  has_facts: z.boolean(),
});

// One POST multiplexes write/read/search/delete/list as a named union (not split into 5 routes: the action rides in the BODY); memory-contract.test.ts is what actually holds it to that shape since zodResponse doesn't validate at runtime.
export const MemoryOperationSchema = z.union([
  /** write — the row it landed, from the pool or the file fallback alike. */
  z.object({
    key: z.string(),
    version: z.number(),
    agent_id: z.string(),
    created_at: z.string(),
  }),
  /** read — latest or one named version; null when nothing readable; always carries the key. */
  z
    .object({
      key: z.string(),
      value: z.string(),
      version: z.number(),
      created_at: z.string(),
    })
    .nullable(),
  /** read, `version: "all"` — every version, newest first. */
  z.array(MemoryVersionSchema),
  /** search — hits across memories/facts/episodes/graph; file fallback searches memories only. */
  z.array(
    z.object({
      key: z.string(),
      value: z.string(),
      score: z.number(),
      agent_id: z.string(),
      source: z.enum(["memory", "fact", "episode", "graph"]),
      id: z.string().optional(),
      confidence: z.string().optional(),
    }),
  ),
  /** delete — soft-delete acknowledgement. */
  z.object({ key: z.string(), deleted: z.boolean() }),
  /** list — a page, with the window the caller asked for echoed back. */
  z.object({
    memories: z.array(MemoryListEntrySchema),
    total: z.number(),
    limit: z.number(),
    offset: z.number(),
  }),
]);

/** A write embeds its value and a search its query; every other action needs none. */
async function embeddingFor(body: MemoryBody): Promise<number[] | null> {
  if (body.action === "write") {
    return getQueryEmbedding(body.value);
  }

  return body.action === "search" ? getQueryEmbedding(body.query) : null;
}

async function writeAction(
  pool: Pool | null,
  body: Extract<MemoryBody, { action: "write" }>,
  embedding: number[] | null,
): Promise<object> {
  const written = isMemoryDbAvailable()
    ? await writeMemory({
        key: body.key,
        value: body.value,
        agentId: body.agent_id,
        ttl: body.ttl,
        embedding: embedding || undefined,
        repo: body.repo,
      })
    : writeMemoryFile(body.key, body.value, body.agent_id, body.ttl);

  // Fire-and-forget: the caller is waiting on the write, not on the facts.
  if (body.extract_facts && isMemoryDbAvailable()) {
    void extractFactsForMemory(pool!, {
      key: body.key,
      value: body.value,
      agentId: resolveAgentId(body.agent_id),
      repo: body.repo,
    });
  }

  return written;
}

async function readAction(
  body: Extract<MemoryBody, { action: "read" }>,
): Promise<object> {
  const version = requestedVersion(body.version);

  return (
    isMemoryDbAvailable()
      ? await readMemory(body.key, body.agent_id, version)
      : readMemoryFile(body.key, body.agent_id, version)
  ) as object;
}

/** `all` asks for the whole history; anything else names one version; absent means the latest. */
function requestedVersion(
  version: string | number | undefined,
): "all" | number | undefined {
  if (version === "all") {
    return "all";
  }

  return version ? Number(version) : undefined;
}

async function searchAction(
  pool: Pool | null,
  body: Extract<MemoryBody, { action: "search" }>,
): Promise<object> {
  return isMemoryDbAvailable()
    ? searchMemories(pool!, body.query, {
        agentId: body.agent_id,
        poolName: body.pool_name,
        limit: body.limit || 10,
        includeInvalidated: body.include_invalidated,
        graphAugment: body.graph_augment,
      })
    : searchMemoryFile(body.query, body.agent_id, body.limit || 10);
}

async function listAction(
  body: Extract<MemoryBody, { action: "list" }>,
): Promise<object> {
  const result = isMemoryDbAvailable()
    ? await listMemories(body.agent_id, body.limit, body.offset)
    : listMemoriesFile(body.agent_id, body.limit, body.offset);

  return { ...result, limit: body.limit, offset: body.offset };
}

export function memoryRoute(getPool: () => Pool | null): ServerRoute {
  return {
    method: "POST",
    path: "/api/memory",
    options: zodResponse(
      {
        ...bearerScope("write"),
        validate: { payload: zodValidate(MemoryBody) },
      },
      MemoryOperationSchema,
      {
        name: "MemoryOperationResult",
        description: "The result of the requested memory action",
        errors: [400, 404],
      },
    ),
    handler: async (request, h) => {
      const pool = getPool();
      const body = request.payload as MemoryBody;

      try {
        // Only the two actions that carry text to match on pay for an embedding.
        const embedding = await embeddingFor(body);

        if (body.action === "write") {
          return h.response(await writeAction(pool, body, embedding));
        }

        if (body.action === "read") {
          return h.response(await readAction(body));
        }

        if (body.action === "search") {
          return h.response(await searchAction(pool, body));
        }

        if (body.action === "delete") {
          return h.response(
            isMemoryDbAvailable()
              ? await deleteMemory(body.key, body.agent_id)
              : deleteMemoryFile(body.key, body.agent_id),
          );
        }

        return h.response(await listAction(body));
      } catch (err) {
        return h.response({ error: errorMessage(err) }).code(500);
      }
    },
  };
}
