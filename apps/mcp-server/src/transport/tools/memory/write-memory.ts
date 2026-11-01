import { errorMessage, resolveAgentId } from "@re-cinq/lore-shared";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { writeMemoryFile } from "@re-cinq/lore-server-core/features/memory/memory-file.js";
import { invalidate as invalidateCache } from "@re-cinq/lore-server-core/platform/proxy-cache.js";
import { proxyMemory, textResult } from "../shared/deps.js";
import {
  invalidRepoRefusal,
  resolveRepo,
  type ServerMode,
} from "../shared/repo-scope.js";
import { writeMemoryInput } from "./shared/memory-tools-schemas.js";
import { interpretMemoryProxy } from "./shared/interpret-memory-proxy.js";
import {
  MEMORY_DERIVED_READS,
  type KeyedMemoryArgs,
} from "./shared/memory-derived-reads.js";

interface WriteMemoryArgs extends KeyedMemoryArgs {
  value: string;
  ttl?: number;
  extract_facts?: boolean;
  repo?: string;
}

export function registerWriteMemoryTool(server: McpServer, mode: ServerMode) {
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
