import { errorMessage, resolveAgentId } from "@re-cinq/lore-shared";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { invalidate as invalidateCache } from "@re-cinq/lore-server-core/platform/proxy-cache.js";
import { proxyToApi, textResult } from "../shared/deps.js";
import { WRITE_EPISODE_INPUT } from "../memory/shared/memory-tools-schemas.js";
import { interpretMemoryProxy } from "../memory/shared/interpret-memory-proxy.js";

const EPISODE_DERIVED_READS = [
  "lore_search_memory",
  "lore_query_graph",
  "lore_assemble_context",
];

// No file fallback: an episode is only useful once its facts and graph entities have been extracted, and that happens server-side. Saying so beats writing a blob nowhere reads.
interface WriteEpisodeArgs {
  content: string;
  source: string;
  ref?: string;
  agent_id?: string;
}

export function registerWriteEpisodeTool(server: McpServer) {
  server.tool(
    "lore_write_episode",
    `Ingests one raw uncurated text blob as a deduplicated episode; returns {status: "ok", episode_id, source, ref} or {status: "duplicate"} when already ingested. Content is secret-redacted; facts and graph entities/edges are extracted asynchronously. Use for bulk/passive capture where you do not want to choose a key and do not need the text individually addressable. Instead: lore_write_memory for a curated nugget you want to retrieve by a specific key. No file fallback — requires DB or API.`,
    WRITE_EPISODE_INPUT,
    writeEpisodeHandler,
  );
}

async function writeEpisodeHandler(args: WriteEpisodeArgs) {
  try {
    const handled = interpretMemoryProxy(
      "lore_write_episode",
      await proxyToApi("/api/episode", {
        ...args,
        agent_id: args.agent_id || resolveAgentId(),
      }),
      () => invalidateCache(EPISODE_DERIVED_READS),
    );

    return (
      handled ??
      textResult(
        "Episodes require PostgreSQL or LORE_API_URL. Neither is configured.",
      )
    );
  } catch (err) {
    return textResult(`Error writing episode: ${errorMessage(err)}`);
  }
}
