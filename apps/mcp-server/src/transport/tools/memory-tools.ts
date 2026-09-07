import { errorMessage } from "@re-cinq/lore-shared";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { resolveAgentId } from "@re-cinq/lore-shared";
import {
  writeMemoryFile,
  readMemoryFile,
  deleteMemoryFile,
  listMemoriesFile,
  searchMemoryFile,
} from "@re-cinq/lore-server-core/features/memory/memory-file.js";
import { detectCurrentRepo } from "@re-cinq/lore-server-core/features/repo/repo-detect.js";
import { proxyMemory, withReadCache, textResult } from "./deps.js";
import { invalidate as invalidateCache } from "@re-cinq/lore-server-core/platform/proxy-cache.js";
import {
  WRITE_MEMORY_INPUT,
  READ_MEMORY_INPUT,
  DELETE_MEMORY_INPUT,
  LIST_MEMORIES_INPUT,
  SEARCH_MEMORY_INPUT,
} from "./memory-tools-schemas.js";
import { registerGraphEpisodeTools } from "./graph-episode-tools.js";
import { interpretMemoryProxy } from "./interpret-memory-proxy.js";

export { interpretMemoryProxy } from "./interpret-memory-proxy.js";

// Reads whose results a memory/episode write can change; over-invalidating is safe, it only forces the next read to re-fetch.
const MEMORY_DERIVED_READS = [
  "lore_search_memory",
  "lore_read_memory",
  "lore_list_memories",
  "lore_assemble_context",
];

export function registerMemoryTools(server: McpServer) {
  registerWriteMemoryTool(server);
  registerReadMemoryTool(server);
  registerDeleteMemoryTool(server);
  registerListMemoriesTool(server);
  registerSearchMemoryTool(server);
  registerGraphEpisodeTools(server);
}

function registerWriteMemoryTool(server: McpServer) {
  server.tool(
    "lore_write_memory",
    `Stores one curated key/value memory (versioned, repo-scoped when a repo is detected, agent-scoped otherwise) and returns {key, version, agent_id, created_at}. Use when you have a decision, convention, correction, or session summary you want to retrieve later by a key you choose. Instead: lore_write_episode for raw uncurated text with no chosen key.`,
    WRITE_MEMORY_INPUT,
    async ({ key, value, agent_id, ttl, extract_facts }) => {
      try {
        const repo = detectCurrentRepo() || undefined;
        const proxied = await proxyMemory("write", {
          key,
          value,
          agent_id: agent_id || resolveAgentId(),
          ttl,
          repo,
          extract_facts,
        });
        const handled = interpretMemoryProxy("lore_write_memory", proxied, () =>
          invalidateCache(MEMORY_DERIVED_READS),
        );

        if (handled) {
          return handled;
        }
        // File fallback only when LORE_API_URL is not configured (true offline mode)
        const result = writeMemoryFile(key, value, agent_id, ttl);

        return textResult(JSON.stringify(result));
      } catch (err) {
        return textResult(`Error writing memory: ${errorMessage(err)}`);
      }
    },
  );
}

function resolveVersionParam(
  version: string | undefined,
): "all" | number | undefined {
  if (version === "all") {
    return "all";
  }

  return version ? Number(version) : undefined;
}

/** What these tools resolve to. `textResult` returns a one-element tuple and the proxy interpreter returns an array; naming the wider shape lets both flow out of one function. */
type ToolText = { content: Array<{ type: "text"; text: string }> };

/** Every memory read answers the same way: the cached proxy first, the server's own answer when it has one, and the local `~/.lore/memory` store when it does not. That fallback is why these tools still answer on a laptop with no API configured. */
async function cachedMemoryRead(
  spec: {
    tool: string;
    op: "read" | "list" | "search";
    args: Record<string, unknown>;
    repo?: string;
  },
  fromFile: () => ToolText,
): Promise<ToolText> {
  const proxied = await withReadCache(
    {
      tool: spec.tool,
      args: spec.args,
      repo: spec.repo,
      ttlSeconds: 300,
    },
    () => proxyMemory(spec.op, spec.args),
  );

  return interpretMemoryProxy(spec.tool, proxied) ?? fromFile();
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
    () => {
      const result = readMemoryFile(
        key,
        agent_id,
        resolveVersionParam(version),
      );

      return result
        ? textResult(JSON.stringify(result, null, 2))
        : textResult(`Memory "${key}" not found.`);
    },
  );
}

function registerReadMemoryTool(server: McpServer) {
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

function registerDeleteMemoryTool(server: McpServer) {
  server.tool(
    "lore_delete_memory",
    `Soft-deletes a memory by key (hides it from read/list/search; version history is retained) and returns {key, deleted: true}. Scope is agent_id, not repo. Use to retire a stale or mistaken memory. Instead: lore_cancel_local_task to stop a local background task; lore_cancel_task to cancel a pipeline task — those are unrelated.`,
    DELETE_MEMORY_INPUT,
    async ({ key, agent_id }) => {
      try {
        const proxied = await proxyMemory("delete", {
          key,
          agent_id: agent_id || resolveAgentId(),
        });
        const handled = interpretMemoryProxy(
          "lore_delete_memory",
          proxied,
          () => invalidateCache(MEMORY_DERIVED_READS),
        );

        if (handled) {
          return handled;
        }
        const result = deleteMemoryFile(key, agent_id);

        return textResult(JSON.stringify(result));
      } catch (err) {
        return textResult(`Error deleting memory: ${errorMessage(err)}`);
      }
    },
  );
}

function registerListMemoriesTool(server: McpServer) {
  server.tool(
    "lore_list_memories",
    `Lists memory keys for the current repo (newest-first, paginated), returning {memories: [{key, agent_id, repo, version, created_at, ttl_seconds, has_facts}], total}. Scope: detected repo wins; falls back to agent_id; then org-wide. Excludes expired and soft-deleted entries. Use to browse existing keys without ranking. Instead: lore_search_memory to find memories by meaning; lore_read_memory to fetch one specific value.`,
    LIST_MEMORIES_INPUT,
    async ({ agent_id, limit, offset }) => {
      try {
        // The detected repo scopes the listing; without one it falls back to the agent, then org-wide.
        const repo = detectCurrentRepo() || undefined;

        return await cachedMemoryRead(
          {
            tool: "lore_list_memories",
            op: "list",
            args: { agent_id: agent_id || undefined, limit, repo },
            repo,
          },
          () =>
            textResult(
              JSON.stringify(
                listMemoriesFile(agent_id, limit, offset),
                null,
                2,
              ),
            ),
        );
      } catch (err) {
        return textResult(`Error listing memories: ${errorMessage(err)}`);
      }
    },
  );
}

/** Semantic search, or substring matching when it falls back — the file store holds no embeddings, so a laptop with no API gets a strictly weaker answer rather than none. */
async function searchMemory(args: {
  query: string;
  agent_id?: string;
  pool?: string;
  limit: number;
  include_invalidated?: boolean;
  graph_augment?: boolean;
}): Promise<ToolText> {
  const { query, agent_id, pool, limit } = args;

  return cachedMemoryRead(
    {
      tool: "lore_search_memory",
      op: "search",
      args: {
        query,
        agent_id: agent_id || undefined,
        pool_name: pool,
        limit,
        include_invalidated: args.include_invalidated,
        graph_augment: args.graph_augment,
      },
    },
    () =>
      textResult(
        JSON.stringify(searchMemoryFile(query, agent_id, limit), null, 2),
      ),
  );
}

function registerSearchMemoryTool(server: McpServer) {
  server.tool(
    "lore_search_memory",
    `Semantic (vector + keyword) search across org-wide memories and extracted facts; returns a relevance-ranked array of {key, value, score, agent_id, source, id?, confidence?} (source: memory|fact|episode|graph). Use to find past learnings, decisions, corrections, and facts when you do NOT have an exact key. Instead: lore_read_memory for exact-key lookup; lore_list_memories to enumerate keys; lore_search_context for raw repo document passages (conventions, ADRs, .md text); lore_query_graph to traverse entity relationships; lore_assemble_context for the token-budgeted startup bundle (the mandatory first call).`,
    SEARCH_MEMORY_INPUT,
    async (args) => {
      try {
        return await searchMemory(args);
      } catch (err) {
        return textResult(`Error searching memories: ${errorMessage(err)}`);
      }
    },
  );
}
