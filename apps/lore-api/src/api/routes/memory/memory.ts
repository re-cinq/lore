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

export function memoryRoute(getPool: () => Pool | null): ServerRoute {
  return {
    method: "POST",
    path: "/api/memory",
    options: {
      ...bearerScope("write"),
      validate: { payload: zodValidate(MemoryBody) },
    },
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
          case "write":
            return h.response(
              isMemoryDbAvailable()
                ? await writeMemory(
                    body.key,
                    body.value,
                    body.agent_id,
                    body.ttl,
                    embedding || undefined,
                    body.repo,
                  )
                : writeMemoryFile(
                    body.key,
                    body.value,
                    body.agent_id,
                    body.ttl,
                  ),
            );
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
      } catch (err: any) {
        return h.response({ error: err.message }).code(500);
      }
    },
  };
}
