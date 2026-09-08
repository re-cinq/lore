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

// A memory addressed by key. `agent_id` is optional everywhere: absent means "this agent", resolved once at the edge.
interface KeyedMemoryArgs {
  key: string;
  agent_id?: string;
}

interface WriteMemoryArgs extends KeyedMemoryArgs {
  value: string;
  ttl?: number;
  extract_facts?: boolean;
}

// Writes through the API, falling back to the file store ONLY when LORE_API_URL is unset — true offline mode. A configured API that refused is reported, not quietly written to disk, or the two stores would diverge.
async function writeMemoryHandler(args: WriteMemoryArgs) {
  const { key, value, agent_id, ttl } = args;

  try {
    const handled = interpretMemoryProxy(
      "lore_write_memory",
      await proxyMemory("write", writeProxyArgs(args)),
      () => invalidateCache(MEMORY_DERIVED_READS),
    );

    return (
      handled ??
      textResult(JSON.stringify(writeMemoryFile(key, value, agent_id, ttl)))
    );
  } catch (err) {
    return textResult(`Error writing memory: ${errorMessage(err)}`);
  }
}

// The write as the API takes it. The repo is detected HERE rather than passed in: the caller is a tool invocation with no notion of where it is running, and a repo-scoped memory must be scoped by the repo the session is actually in.
function writeProxyArgs(args: WriteMemoryArgs) {
  return {
    key: args.key,
    value: args.value,
    agent_id: args.agent_id || resolveAgentId(),
    ttl: args.ttl,
    repo: detectCurrentRepo() || undefined,
    extract_facts: args.extract_facts,
  };
}

function registerWriteMemoryTool(server: McpServer) {
  server.tool(
    "lore_write_memory",
    `Stores one curated key/value memory (versioned, repo-scoped when a repo is detected, agent-scoped otherwise) and returns {key, version, agent_id, created_at}. Use when you have a decision, convention, correction, or session summary you want to retrieve later by a key you choose. Instead: lore_write_episode for raw uncurated text with no chosen key.`,
    WRITE_MEMORY_INPUT,
    writeMemoryHandler,
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

function registerDeleteMemoryTool(server: McpServer) {
  server.tool(
    "lore_delete_memory",
    `Soft-deletes a memory by key (hides it from read/list/search; version history is retained) and returns {key, deleted: true}. Scope is agent_id, not repo. Use to retire a stale or mistaken memory. Instead: lore_cancel_local_task to stop a local background task; lore_cancel_task to cancel a pipeline task — those are unrelated.`,
    DELETE_MEMORY_INPUT,
    deleteMemoryHandler,
  );
}

// The cache key for one listing. `repo` appears twice on purpose: once as a proxied argument and once as the cache scope, so a listing cached for one repo is never served to another.
function listReadSpec(
  agent_id: string | undefined,
  limit: number,
  repo: string | undefined,
) {
  return {
    tool: "lore_list_memories" as const,
    op: "list" as const,
    args: { agent_id: agent_id || undefined, limit, repo },
    repo,
  };
}

// The offline listing. Paged the same way as the API's, so a laptop with no API sees the same shape rather than the whole store at once.
function listFromFile(
  agent_id: string | undefined,
  limit: number,
  offset: number,
) {
  return textResult(
    JSON.stringify(listMemoriesFile(agent_id, limit, offset), null, 2),
  );
}

// The detected repo scopes the listing; without one it falls back to the agent, then org-wide.
async function listMemoriesHandler({
  agent_id,
  limit,
  offset,
}: {
  agent_id?: string;
  limit: number;
  offset: number;
}) {
  const repo = detectCurrentRepo() || undefined;

  try {
    return await cachedMemoryRead(listReadSpec(agent_id, limit, repo), () =>
      listFromFile(agent_id, limit, offset),
    );
  } catch (err) {
    return textResult(`Error listing memories: ${errorMessage(err)}`);
  }
}

function registerListMemoriesTool(server: McpServer) {
  server.tool(
    "lore_list_memories",
    `Lists memory keys for the current repo (newest-first, paginated), returning {memories: [{key, agent_id, repo, version, created_at, ttl_seconds, has_facts}], total}. Scope: detected repo wins; falls back to agent_id; then org-wide. Excludes expired and soft-deleted entries. Use to browse existing keys without ranking. Instead: lore_search_memory to find memories by meaning; lore_read_memory to fetch one specific value.`,
    LIST_MEMORIES_INPUT,
    ({ agent_id, limit, offset }) =>
      listMemoriesHandler({ agent_id, limit, offset }),
  );
}

// The search as the API takes it — `pool` becomes `pool_name`, and an empty agent is dropped rather than sent as "".
function searchProxyArgs(args: SearchMemoryArgs) {
  return {
    query: args.query,
    agent_id: args.agent_id || undefined,
    pool_name: args.pool,
    limit: args.limit,
    include_invalidated: args.include_invalidated,
    graph_augment: args.graph_augment,
  };
}

/** Semantic search, or substring matching when it falls back — the file store holds no embeddings, so a laptop with no API gets a strictly weaker answer rather than none. */
interface SearchMemoryArgs {
  query: string;
  agent_id?: string;
  pool?: string;
  limit: number;
  include_invalidated?: boolean;
  graph_augment?: boolean;
}

async function searchMemory(args: SearchMemoryArgs): Promise<ToolText> {
  const { query, agent_id, limit } = args;

  return cachedMemoryRead(
    { tool: "lore_search_memory", op: "search", args: searchProxyArgs(args) },
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
