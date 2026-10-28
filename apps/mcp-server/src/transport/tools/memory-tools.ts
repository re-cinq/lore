import { errorMessage } from "@re-cinq/lore-shared";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { resolveAgentId } from "@re-cinq/lore-shared";
import {
  writeMemoryFile,
  readMemoryFile,
  deleteMemoryFile,
  listMemoriesFile,
} from "@re-cinq/lore-server-core/features/memory/memory-file.js";
import { proxyMemory, textResult } from "./deps.js";
import { invalidate as invalidateCache } from "@re-cinq/lore-server-core/platform/proxy-cache.js";
import {
  writeMemoryInput,
  READ_MEMORY_INPUT,
  DELETE_MEMORY_INPUT,
  LIST_MEMORIES_INPUT,
} from "./memory-tools-schemas.js";
import { registerGraphEpisodeTools } from "./graph-episode-tools.js";
import { cachedMemoryRead } from "./memory-cached-read.js";
import { registerSearchMemoryTool } from "./memory-search-tool.js";
import { interpretMemoryProxy } from "./interpret-memory-proxy.js";
import {
  invalidRepoRefusal,
  NO_REPO_GIVEN,
  repoParam,
  resolveRepo,
  type ServerMode,
} from "./repo-scope.js";

export { interpretMemoryProxy } from "./interpret-memory-proxy.js";

// Reads whose results a memory/episode write can change; over-invalidating is safe, it only forces the next read to re-fetch.
const MEMORY_DERIVED_READS = [
  "lore_search_memory",
  "lore_read_memory",
  "lore_list_memories",
  "lore_assemble_context",
];

// A memory addressed by key. `agent_id` is optional everywhere: absent means "this agent", resolved once at the edge.
interface KeyedMemoryArgs {
  key: string;
  agent_id?: string;
}

interface WriteMemoryArgs extends KeyedMemoryArgs {
  value: string;
  ttl?: number;
  extract_facts?: boolean;
  repo?: string;
}

export function registerMemoryTools(server: McpServer, mode: ServerMode) {
  registerWriteMemoryTool(server, mode);
  registerReadMemoryTool(server);
  registerDeleteMemoryTool(server);
  registerListMemoriesTool(server, mode);
  registerSearchMemoryTool(server, mode);
  registerGraphEpisodeTools(server);
}

function registerWriteMemoryTool(server: McpServer, mode: ServerMode) {
  server.tool(
    "lore_write_memory",
    `Stores one curated key/value memory (versioned, repo-scoped when a repo is given or detected, agent-scoped otherwise) and returns {key, version, agent_id, created_at}. Use when you have a decision, convention, correction, or session summary you want to retrieve later by a key you choose. Instead: lore_write_episode for raw uncurated text with no chosen key.`,
    writeMemoryInput(mode),
    (args) => writeMemoryHandler(args, mode),
  );
}

// Writes through the API, falling back to the file store ONLY when LORE_API_URL is unset — true offline mode. A configured API that refused is reported, not quietly written to disk, or the two stores would diverge.
async function writeMemoryHandler(args: WriteMemoryArgs, mode: ServerMode) {
  const { key, value, agent_id, ttl } = args;
  const refusal = invalidRepoRefusal(args.repo);

  if (refusal) {
    return textResult(refusal);
  }

  try {
    const handled = interpretMemoryProxy(
      "lore_write_memory",
      await proxyMemory("write", writeProxyArgs(args, mode)),
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

// The write as the API takes it. The repo is the one the caller names, else the checkout the session is in; the shared gateway has no checkout, so there only a named repo scopes the memory.
function writeProxyArgs(args: WriteMemoryArgs, mode: ServerMode) {
  return {
    key: args.key,
    value: args.value,
    agent_id: args.agent_id || resolveAgentId(),
    ttl: args.ttl,
    repo: resolveRepo(args.repo, mode) || undefined,
    extract_facts: args.extract_facts,
  };
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

function registerDeleteMemoryTool(server: McpServer) {
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

function registerListMemoriesTool(server: McpServer, mode: ServerMode) {
  server.tool(
    "lore_list_memories",
    `Lists memory keys for a repo (newest-first, paginated), returning {memories: [{key, agent_id, repo, version, created_at, ttl_seconds, has_facts}], total}. Scope: the given or detected repo wins; falls back to agent_id; then org-wide. Excludes expired and soft-deleted entries. Use to browse existing keys without ranking. Instead: lore_search_memory to find memories by meaning; lore_read_memory to fetch one specific value.`,
    { ...LIST_MEMORIES_INPUT, repo: repoParam(mode) },
    ({ agent_id, limit, offset, repo }) =>
      listMemoriesScoped({ agent_id, limit, offset, repo }, mode),
  );
}

function listMemoriesScoped(
  args: { agent_id?: string; limit: number; offset: number; repo?: string },
  mode: ServerMode,
) {
  const refusal =
    invalidRepoRefusal(args.repo) ??
    (mode === "agent" && !args.repo ? NO_REPO_GIVEN : null);

  if (refusal) {
    return textResult(refusal);
  }

  return listMemoriesHandler({
    ...args,
    repo: resolveRepo(args.repo, mode) || undefined,
  });
}

// The detected repo scopes the listing; without one it falls back to the agent, then org-wide.
async function listMemoriesHandler({
  agent_id,
  limit,
  offset,
  repo,
}: {
  agent_id?: string;
  limit: number;
  offset: number;
  repo?: string;
}) {
  try {
    return await cachedMemoryRead(
      listReadSpec(agent_id, limit, offset, repo),
      () => listFromFile(agent_id, limit, offset),
    );
  } catch (err) {
    return textResult(`Error listing memories: ${errorMessage(err)}`);
  }
}

// The cache key for one listing. `repo` appears twice on purpose: once as a proxied argument and once as the cache scope, so a listing cached for one repo is never served to another.
function listReadSpec(
  agent_id: string | undefined,
  limit: number,
  offset: number,
  repo: string | undefined,
) {
  return {
    tool: "lore_list_memories" as const,
    op: "list" as const,
    args: { agent_id: agent_id || undefined, limit, offset, repo },
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
