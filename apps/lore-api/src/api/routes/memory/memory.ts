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

const version = z.union([z.string(), z.number()]).optional();
// Non-coerced (unlike common-schemas' clampedLimit/offsetParam): this is a JSON
// body, so a stringy limit/offset is malformed and rejected rather than parsed.
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
    // Carried from lore_search_memory, which has no pool of its own to honor
    // them with (ADR-032).
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

/**
 * One POST multiplexes write, read, search, delete and list, and each answers a
 * different shape — so the contract is stated as the open document it genuinely
 * is rather than as one of the five pretending to be all of them. Splitting the
 * actions into their own routes is what would buy five precise contracts.
 */
const MemoryOperationSchema = z.record(z.unknown());

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
        const embedInput =
          body.action === "write"
            ? body.value
            : body.action === "search"
              ? body.query
              : undefined;
        const embedding = embedInput
          ? await getQueryEmbedding(embedInput)
          : null;

        switch (body.action) {
          case "write": {
            const written = isMemoryDbAvailable()
              ? await writeMemory(
                  body.key,
                  body.value,
                  body.agent_id,
                  body.ttl,
                  embedding || undefined,
                  body.repo,
                )
              : writeMemoryFile(body.key, body.value, body.agent_id, body.ttl);

            // Fire-and-forget: fact extraction calls an LLM, and the caller is
            // waiting on the write, not on the facts.
            if (body.extract_facts && isMemoryDbAvailable()) {
              void extractFactsForMemory(pool!, {
                key: body.key,
                value: body.value,
                agentId: resolveAgentId(body.agent_id),
                repo: body.repo,
              });
            }

            return h.response(written);
          }
          case "read": {
            const v =
              body.version === "all"
                ? "all"
                : body.version
                  ? Number(body.version)
                  : undefined;

            return h.response(
              (isMemoryDbAvailable()
                ? await readMemory(body.key, body.agent_id, v)
                : readMemoryFile(body.key, body.agent_id, v)) as object,
            );
          }
          case "search":
            return h.response(
              isMemoryDbAvailable()
                ? await searchMemories(
                    pool!,
                    body.query,
                    body.agent_id,
                    body.pool_name,
                    body.limit || 10,
                    body.include_invalidated,
                    body.graph_augment,
                  )
                : searchMemoryFile(body.query, body.agent_id, body.limit || 10),
            );
          case "delete":
            return h.response(
              isMemoryDbAvailable()
                ? await deleteMemory(body.key, body.agent_id)
                : deleteMemoryFile(body.key, body.agent_id),
            );
          case "list": {
            const result = isMemoryDbAvailable()
              ? await listMemories(body.agent_id, body.limit, body.offset)
              : listMemoriesFile(body.agent_id, body.limit, body.offset);

            return h.response({
              ...result,
              limit: body.limit,
              offset: body.offset,
            });
          }
        }
      } catch (err) {
        return h.response({ error: errorMessage(err) }).code(500);
      }
    },
  };
}
