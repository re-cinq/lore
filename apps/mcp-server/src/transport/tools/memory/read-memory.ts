import { errorMessage, resolveAgentId } from "@re-cinq/lore-shared";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { readMemoryFile } from "@re-cinq/lore-server-core/features/memory/memory-file.js";
import { textResult } from "../shared/deps.js";
import { READ_MEMORY_INPUT } from "./shared/memory-tools-schemas.js";
import { cachedMemoryRead } from "./shared/memory-cached-read.js";

export function registerReadMemoryTool(server: McpServer) {
  server.tool(
    "lore_read_memory",
    `Fetches one memory by its exact key and returns the stored row as JSON (latest version by default, or full history/specific version on request). Use only when you already know the precise key. Instead: lore_search_memory when searching by meaning; lore_list_memories to enumerate keys.`,
    READ_MEMORY_INPUT,
    async (args) => {
      try {
        return await readMemory(args);
      } catch (err) {
        return textResult(`Error reading memory: ${errorMessage(err)}`);
      }
    },
  );
}

/** The exact-key read. A miss is reported as a miss rather than an error — asking for a key that is not there is an ordinary answer. */
async function readMemory(args: {
  key: string;
  agent_id?: string;
  version?: string;
}) {
  const { key, agent_id, version } = args;

  return cachedMemoryRead(
    {
      tool: "lore_read_memory",
      op: "read",
      args: { key, agent_id: agent_id || resolveAgentId(), version },
    },
    () => readMemoryFromFile(key, agent_id, version),
  );
}

// The offline read. A miss is reported as a miss rather than an error — asking for a key that is not there is an ordinary answer.
function readMemoryFromFile(
  key: string,
  agent_id: string | undefined,
  version: string | undefined,
) {
  const result = readMemoryFile(key, agent_id, resolveVersionParam(version));

  return result
    ? textResult(JSON.stringify(result, null, 2))
    : textResult(`Memory "${key}" not found.`);
}

function resolveVersionParam(
  version: string | undefined,
): "all" | number | undefined {
  if (version === "all") {
    return "all";
  }

  return version ? Number(version) : undefined;
}
