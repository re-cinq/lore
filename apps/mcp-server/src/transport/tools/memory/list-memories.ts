import { errorMessage } from "@re-cinq/lore-shared";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { listMemoriesFile } from "@re-cinq/lore-server-core/features/memory/memory-file.js";
import { textResult } from "../shared/deps.js";
import {
  invalidRepoRefusal,
  NO_REPO_GIVEN,
  repoParam,
  resolveRepo,
  type ServerMode,
} from "../shared/repo-scope.js";
import { LIST_MEMORIES_INPUT } from "./shared/memory-tools-schemas.js";
import { cachedMemoryRead } from "./shared/memory-cached-read.js";

export function registerListMemoriesTool(server: McpServer, mode: ServerMode) {
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
