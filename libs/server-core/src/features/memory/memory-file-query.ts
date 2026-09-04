// Cross-key reads over the file-backed memory store: paginated listing and case-insensitive substring search.

import { resolveAgentId } from "../../platform/agent-id.js";
import {
  memoriesPath,
  isExpired,
  readJson,
  appendAudit,
  type MemoryRecord,
  type MemoryListEntry,
  type SearchResult,
} from "./memory-file.js";

export function listMemoriesFile(
  agentId?: string,
  limit: number = 50,
  offset: number = 0,
): { memories: MemoryListEntry[]; total: number } {
  const id = resolveAgentId(agentId);
  const memories = readJson<Record<string, MemoryRecord>>(memoriesPath(id), {});

  // Filter out deleted and expired entries
  const active: MemoryListEntry[] = [];

  for (const [key, record] of Object.entries(memories)) {
    if (record.is_deleted || isExpired(record)) {
      continue;
    }
    active.push({
      key,
      agent_id: id,
      repo: null,
      version: record.version,
      created_at: record.created_at,
      ttl_seconds: record.ttl_seconds,
      has_facts: false,
    });
  }

  // Sort by created_at descending (newest first)
  active.sort((a, b) => b.created_at.localeCompare(a.created_at));

  const total = active.length;
  const paged = active.slice(offset, offset + limit);

  appendAudit({
    agent_id: id,
    operation: "list",
    memory_key: null,
    pool_name: null,
    metadata: { limit, offset, total },
  });

  return { memories: paged, total };
}

function isInactive(record: MemoryRecord): boolean {
  return record.is_deleted || isExpired(record);
}

function matchesQuery(
  key: string,
  record: MemoryRecord,
  lowerQuery: string,
): boolean {
  return (
    key.toLowerCase().includes(lowerQuery) ||
    record.value.toLowerCase().includes(lowerQuery)
  );
}

function collectSearchResults(
  memories: Record<string, MemoryRecord>,
  agentId: string,
  lowerQuery: string,
  limit: number,
): SearchResult[] {
  const results: SearchResult[] = [];

  for (const [key, record] of Object.entries(memories)) {
    if (isInactive(record)) {
      continue;
    }

    if (matchesQuery(key, record, lowerQuery)) {
      results.push({
        key,
        value: record.value,
        version: record.version,
        score: 1.0,
        agent_id: agentId,
        created_at: record.created_at,
        source: "memory",
      });
    }

    if (results.length >= limit) {
      break;
    }
  }

  return results;
}

export function searchMemoryFile(
  query: string,
  agentId?: string,
  limit: number = 10,
): SearchResult[] {
  const id = resolveAgentId(agentId);
  const memories = readJson<Record<string, MemoryRecord>>(memoriesPath(id), {});
  const lowerQuery = query.toLowerCase();
  const results = collectSearchResults(memories, id, lowerQuery, limit);

  appendAudit({
    agent_id: id,
    operation: "search",
    memory_key: null,
    pool_name: null,
    metadata: { query, result_count: results.length },
  });

  return results;
}
