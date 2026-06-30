import type { IncomingMessage, ServerResponse } from "node:http";
import type { Pool } from "pg";
import { getQueryEmbedding } from "@re-cinq/lore-server-core/platform/db.js";
import { isMemoryDbAvailable, writeMemory, readMemory, deleteMemory, listMemories } from "@re-cinq/lore-server-core/features/memory/memory.js";
import { writeMemoryFile, readMemoryFile, deleteMemoryFile, listMemoriesFile, searchMemoryFile } from "@re-cinq/lore-server-core/features/memory/memory-file.js";
import { searchMemories } from "@re-cinq/lore-server-core/features/memory/memory-search.js";
import { json, readBody } from "../http.js";

export async function handleMemory(req: IncomingMessage, res: ServerResponse, pool: Pool | null): Promise<void> {
  const body = await readBody(req);
  try {
    const { action, key, value, agent_id, ttl, query: searchQuery, limit, version, pool_name, repo } = JSON.parse(body);
    let result: any;
    const embedding = (action === "write" || action === "search") && (value || searchQuery) ? await getQueryEmbedding(value || searchQuery) : null;

    switch (action) {
      case "write":
        if (!key || !value) { json(res, 400, { error: "key and value required" }); return; }
        result = isMemoryDbAvailable()
          ? await writeMemory(key, value, agent_id, ttl, embedding || undefined, repo)
          : await writeMemoryFile(key, value, agent_id, ttl);
        break;
      case "read":
        if (!key) { json(res, 400, { error: "key required" }); return; }
        result = isMemoryDbAvailable()
          ? await readMemory(key, agent_id, version === "all" ? "all" : version ? Number(version) : undefined)
          : await readMemoryFile(key, agent_id, version === "all" ? "all" : version ? Number(version) : undefined);
        break;
      case "search":
        if (!searchQuery) { json(res, 400, { error: "query required" }); return; }
        result = isMemoryDbAvailable()
          ? await searchMemories(pool!, searchQuery, agent_id, pool_name, limit || 10)
          : await searchMemoryFile(searchQuery, agent_id, limit || 10);
        break;
      case "delete":
        if (!key) { json(res, 400, { error: "key required" }); return; }
        result = isMemoryDbAvailable()
          ? await deleteMemory(key, agent_id)
          : await deleteMemoryFile(key, agent_id);
        break;
      case "list":
        result = isMemoryDbAvailable()
          ? await listMemories(agent_id, limit || 50, 0)
          : await listMemoriesFile(agent_id, limit || 50, 0);
        break;
      default:
        json(res, 400, { error: "action must be: write, read, search, delete, list" });
        return;
    }
    json(res, 200, result);
  } catch (err: any) {
    json(res, 500, { error: err.message });
  }
}
