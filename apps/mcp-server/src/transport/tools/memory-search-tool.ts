import { errorMessage, resolveAgentId } from "@re-cinq/lore-shared";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { KnowledgeBackend } from "@re-cinq/lore-shared/knowledge-backend.js";
import { searchMemoryFile } from "@re-cinq/lore-server-core/features/memory/memory-file.js";
import { textResult } from "./deps.js";
import { backendNeedsApi, readsUtopia } from "./backend-param.js";
import { cachedMemoryRead, type ToolText } from "./memory-cached-read.js";
import { SEARCH_MEMORY_INPUT } from "./memory-tools-schemas.js";
import {
  invalidRepoRefusal,
  resolveRepo,
  type ServerMode,
} from "./repo-scope.js";

interface SearchMemoryArgs {
  query: string;
  agent_id?: string;
  pool?: string;
  limit: number;
  include_invalidated?: boolean;
  graph_augment?: boolean;
  backend?: KnowledgeBackend;
  repo?: string;
}

export function registerSearchMemoryTool(server: McpServer, mode: ServerMode) {
  server.tool(
    "lore_search_memory",
    `Semantic (vector + keyword) search across org-wide memories and extracted facts. A lore search returns a bare relevance-ranked list of {key, value, score, agent_id, source, id?, confidence?} (source: memory|fact|episode|graph); utopia (the default) or both return {results: [...], notes: [...]}, each hit carrying backend: lore|utopia and notes naming a store that could not answer. The given or detected repo chooses which Utopia base is searched beside the org's. Use to find past learnings, decisions, corrections, and facts when you do NOT have an exact key. Instead: lore_read_memory for exact-key lookup; lore_list_memories to enumerate keys; lore_search_context for raw repo document passages (conventions, ADRs, .md text); lore_query_graph to traverse entity relationships; lore_assemble_context for the token-budgeted startup bundle (the mandatory first call).`,
    SEARCH_MEMORY_INPUT,
    async (args) => {
      try {
        return await searchMemory(args, mode);
      } catch (err) {
        return textResult(`Error searching memories: ${errorMessage(err)}`);
      }
    },
  );
}

async function searchMemory(
  args: SearchMemoryArgs,
  mode: ServerMode,
): Promise<ToolText> {
  const refusal = invalidRepoRefusal(args.repo);

  return refusal
    ? textResult(refusal)
    : searchScopedTo(args, resolveRepo(args.repo, mode) || undefined);
}

function searchScopedTo(
  args: SearchMemoryArgs,
  repo: string | undefined,
): Promise<ToolText> {
  return cachedMemoryRead(
    {
      tool: "lore_search_memory",
      op: "search",
      args: searchProxyArgs(args, repo),
      repo,
    },
    () => searchOffline(args),
  );
}

// The offline search reads Lore's `~/.lore` store alone, so a Utopia read is refused rather than answered with it.
function searchOffline({
  query,
  agent_id,
  limit,
  backend,
}: SearchMemoryArgs): ToolText {
  return readsUtopia(backend)
    ? textResult(backendNeedsApi(backend))
    : textResult(
        JSON.stringify(searchMemoryFile(query, agent_id, limit), null, 2),
      );
}

// The search as the API takes it — `pool` becomes `pool_name`, and an empty agent is dropped rather than sent as "". `repo` is the resolved one, so a search from a checkout names the repo it is in.
function searchProxyArgs(args: SearchMemoryArgs, repo: string | undefined) {
  return {
    query: args.query,
    agent_id: args.agent_id || undefined,
    // Always sent, even when the search is org-wide: `agent_id` says what to search, this says who asked.
    actor_id: resolveAgentId(),
    pool_name: args.pool,
    limit: args.limit,
    include_invalidated: args.include_invalidated,
    graph_augment: args.graph_augment,
    backend: args.backend,
    repo,
  };
}
