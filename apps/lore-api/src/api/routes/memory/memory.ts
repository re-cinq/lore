import type { Pool } from "pg";
import type { ServerRoute } from "@hapi/hapi";
import { z } from "zod";
import { getQueryEmbedding } from "@re-cinq/lore-server-core/platform/db.js";
import { isMemoryDbAvailable, writeMemory, readMemory, deleteMemory, listMemories } from "@re-cinq/lore-server-core/features/memory/memory.js";
import { writeMemoryFile, readMemoryFile, deleteMemoryFile, listMemoriesFile, searchMemoryFile } from "@re-cinq/lore-server-core/features/memory/memory-file.js";
import { searchMemories } from "@re-cinq/lore-server-core/features/memory/memory-search.js";
import { bearerScope } from "../../../server/plugins/bearer-scope.js";
import { zodValidate } from "../../../server/plugins/zod-validate.js";

const version = z.union([z.string(), z.number()]).optional();
const MemoryBody = z.discriminatedUnion("action", [
  z.object({ action: z.literal("write"), key: z.string(), value: z.string(), agent_id: z.string().optional(), ttl: z.number().optional(), repo: z.string().optional() }),
  z.object({ action: z.literal("read"), key: z.string(), agent_id: z.string().optional(), version }),
  z.object({ action: z.literal("search"), query: z.string(), agent_id: z.string().optional(), pool_name: z.string().optional(), limit: z.number().optional() }),
  z.object({ action: z.literal("delete"), key: z.string(), agent_id: z.string().optional() }),
  z.object({ action: z.literal("list"), agent_id: z.string().optional(), limit: z.number().optional() }),
]);
type MemoryBody = z.infer<typeof MemoryBody>;

export function memoryRoute(getPool: () => Pool | null): ServerRoute {
  return {
    method: "POST",
    path: "/api/memory",
    options: { ...bearerScope("write"), validate: { payload: zodValidate(MemoryBody) } },
    handler: async (request, h) => {
      const pool = getPool();
      const body = request.payload as MemoryBody;
      try {
        const embedInput = body.action === "write" ? body.value : body.action === "search" ? body.query : undefined;
        const embedding = embedInput ? await getQueryEmbedding(embedInput) : null;

        switch (body.action) {
          case "write":
            return h.response(isMemoryDbAvailable()
              ? await writeMemory(body.key, body.value, body.agent_id, body.ttl, embedding || undefined, body.repo)
              : await writeMemoryFile(body.key, body.value, body.agent_id, body.ttl));
          case "read": {
            const v = body.version === "all" ? "all" : body.version ? Number(body.version) : undefined;
            return h.response(isMemoryDbAvailable()
              ? await readMemory(body.key, body.agent_id, v)
              : await readMemoryFile(body.key, body.agent_id, v));
          }
          case "search":
            return h.response(isMemoryDbAvailable()
              ? await searchMemories(pool!, body.query, body.agent_id, body.pool_name, body.limit || 10)
              : await searchMemoryFile(body.query, body.agent_id, body.limit || 10));
          case "delete":
            return h.response(isMemoryDbAvailable()
              ? await deleteMemory(body.key, body.agent_id)
              : await deleteMemoryFile(body.key, body.agent_id));
          case "list":
            return h.response(isMemoryDbAvailable()
              ? await listMemories(body.agent_id, body.limit || 50, 0)
              : await listMemoriesFile(body.agent_id, body.limit || 50, 0));
        }
      } catch (err: any) {
        return h.response({ error: err.message }).code(500);
      }
    },
  };
}
