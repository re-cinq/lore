import type { Pool } from "pg";
import type { ServerRoute } from "@hapi/hapi";
import { getQueryEmbedding } from "@re-cinq/lore-server-core/platform/db.js";
import { isMemoryDbAvailable, writeMemory, readMemory, deleteMemory, listMemories } from "@re-cinq/lore-server-core/features/memory/memory.js";
import { writeMemoryFile, readMemoryFile, deleteMemoryFile, listMemoriesFile, searchMemoryFile } from "@re-cinq/lore-server-core/features/memory/memory-file.js";
import { searchMemories } from "@re-cinq/lore-server-core/features/memory/memory-search.js";
import { bearerScope } from "../../../server/plugins/bearer-scope.js";
import { rawBody } from "../../../server/raw-body.js";

export function memoryRoute(getPool: () => Pool | null): ServerRoute {
  return {
    method: "POST",
    path: "/api/memory",
    options: { ...bearerScope("write"), payload: { parse: false } },
    handler: async (request, h) => {
      const pool = getPool();
      try {
        const { action, key, value, agent_id, ttl, query: searchQuery, limit, version, pool_name, repo } = JSON.parse(rawBody(request));
        const embedding = (action === "write" || action === "search") && (value || searchQuery) ? await getQueryEmbedding(value || searchQuery) : null;

        switch (action) {
          case "write":
            if (!key || !value) return h.response({ error: "key and value required" }).code(400);
            return h.response(isMemoryDbAvailable()
              ? await writeMemory(key, value, agent_id, ttl, embedding || undefined, repo)
              : await writeMemoryFile(key, value, agent_id, ttl));
          case "read":
            if (!key) return h.response({ error: "key required" }).code(400);
            return h.response(isMemoryDbAvailable()
              ? await readMemory(key, agent_id, version === "all" ? "all" : version ? Number(version) : undefined)
              : await readMemoryFile(key, agent_id, version === "all" ? "all" : version ? Number(version) : undefined));
          case "search":
            if (!searchQuery) return h.response({ error: "query required" }).code(400);
            return h.response(isMemoryDbAvailable()
              ? await searchMemories(pool!, searchQuery, agent_id, pool_name, limit || 10)
              : await searchMemoryFile(searchQuery, agent_id, limit || 10));
          case "delete":
            if (!key) return h.response({ error: "key required" }).code(400);
            return h.response(isMemoryDbAvailable()
              ? await deleteMemory(key, agent_id)
              : await deleteMemoryFile(key, agent_id));
          case "list":
            return h.response(isMemoryDbAvailable()
              ? await listMemories(agent_id, limit || 50, 0)
              : await listMemoriesFile(agent_id, limit || 50, 0));
          default:
            return h.response({ error: "action must be: write, read, search, delete, list" }).code(400);
        }
      } catch (err: any) {
        return h.response({ error: err.message }).code(500);
      }
    },
  };
}
