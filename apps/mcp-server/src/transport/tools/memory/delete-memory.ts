import { errorMessage, resolveAgentId } from "@re-cinq/lore-shared";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { deleteMemoryFile } from "@re-cinq/lore-server-core/features/memory/memory-file.js";
import { invalidate as invalidateCache } from "@re-cinq/lore-server-core/platform/proxy-cache.js";
import { proxyMemory, textResult } from "../shared/deps.js";
import { DELETE_MEMORY_INPUT } from "./shared/memory-tools-schemas.js";
import { interpretMemoryProxy } from "./shared/interpret-memory-proxy.js";
import {
  MEMORY_DERIVED_READS,
  type KeyedMemoryArgs,
} from "./shared/memory-derived-reads.js";

export function registerDeleteMemoryTool(server: McpServer) {
  server.tool(
    "lore_delete_memory",
    `Soft-deletes a memory by key (hides it from read/list/search; version history is retained) and returns {key, deleted: true}. Scope is agent_id, not repo. Use to retire a stale or mistaken memory. Instead: lore_cancel_local_task to stop a local background task; lore_cancel_task to cancel a pipeline task — those are unrelated.`,
    DELETE_MEMORY_INPUT,
    deleteMemoryHandler,
  );
}

// A soft delete: the row is hidden from read/list/search and its version history is kept. Scoped by agent, not repo — a memory belongs to whoever wrote it.
async function deleteMemoryHandler({ key, agent_id }: KeyedMemoryArgs) {
  try {
    const proxied = await proxyMemory("delete", {
      key,
      agent_id: agent_id || resolveAgentId(),
    });
    const handled = interpretMemoryProxy("lore_delete_memory", proxied, () =>
      invalidateCache(MEMORY_DERIVED_READS),
    );

    return (
      handled ?? textResult(JSON.stringify(deleteMemoryFile(key, agent_id)))
    );
  } catch (err) {
    return textResult(`Error deleting memory: ${errorMessage(err)}`);
  }
}
