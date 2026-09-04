import { errorMessage } from "@re-cinq/lore-shared";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { resolveAgentId } from "@re-cinq/lore-server-core/platform/agent-id.js";
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

function registerReadMemoryTool(server: McpServer) {
  server.tool(
    "lore_read_memory",
    `Fetches one memory by its exact key and returns the stored row as JSON (latest version by default, or full history/specific version on request). Use only when you already know the precise key. Instead: lore_search_memory when searching by meaning; lore_list_memories to enumerate keys.`,
    READ_MEMORY_INPUT,
    async ({ key, agent_id, version }) => {
      try {
        const proxied = await withReadCache(
          {
            tool: "lore_read_memory",
            args: { key, agent_id: agent_id || resolveAgentId(), version },
            ttlSeconds: 300,
          },
          () =>
            proxyMemory("read", {
              key,
              agent_id: agent_id || resolveAgentId(),
              version,
            }),
        );
        const handled = interpretMemoryProxy("lore_read_memory", proxied);

        if (handled) {
          return handled;
        }
        const result = readMemoryFile(
          key,
          agent_id,
          resolveVersionParam(version),
        );

        if (!result) {
          return textResult(`Memory "${key}" not found.`);
        }

        return textResult(JSON.stringify(result, null, 2));
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
        const repo = detectCurrentRepo() || undefined;

        const proxied = await withReadCache(
          {
            tool: "lore_list_memories",
            args: { agent_id: agent_id || undefined, limit, repo },
            repo: repo || undefined,
            ttlSeconds: 300,
          },
          () =>
            proxyMemory("list", {
              agent_id: agent_id || undefined,
              limit,
              repo,
            }),
        );
        const handled = interpretMemoryProxy("lore_list_memories", proxied);

        if (handled) {
          return handled;
        }
        const result = listMemoriesFile(agent_id, limit, offset);

        return textResult(JSON.stringify(result, null, 2));
      } catch (err) {
        return textResult(`Error listing memories: ${errorMessage(err)}`);
      }
    },
  );
}

function registerSearchMemoryTool(server: McpServer) {
  server.tool(
    "lore_search_memory",
    `Semantic (vector + keyword) search across org-wide memories and extracted facts; returns a relevance-ranked array of {key, value, score, agent_id, source, id?, confidence?} (source: memory|fact|episode|graph). Use to find past learnings, decisions, corrections, and facts when you do NOT have an exact key. Instead: lore_read_memory for exact-key lookup; lore_list_memories to enumerate keys; lore_search_context for raw repo document passages (conventions, ADRs, .md text); lore_query_graph to traverse entity relationships; lore_assemble_context for the token-budgeted startup bundle (the mandatory first call).`,
    SEARCH_MEMORY_INPUT,
    async ({
      query,
      agent_id,
      pool,
      limit,
      include_invalidated,
      graph_augment,
    }) => {
      try {
        const searchArgs = {
          query,
          agent_id: agent_id || undefined,
          pool_name: pool,
          limit,
          include_invalidated,
          graph_augment,
        };
        const proxied = await withReadCache(
          {
            tool: "lore_search_memory",
            args: searchArgs,
            ttlSeconds: 300,
          },
          () => proxyMemory("search", searchArgs),
        );
        const handled = interpretMemoryProxy("lore_search_memory", proxied);

        if (handled) {
          return handled;
        }
        const results = searchMemoryFile(query, agent_id, limit);

        return textResult(JSON.stringify(results, null, 2));
      } catch (err) {
        return textResult(`Error searching memories: ${errorMessage(err)}`);
      }
    },
  );
}
