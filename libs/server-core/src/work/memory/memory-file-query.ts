// Cross-key reads over the file-backed memory store: paginated listing and case-insensitive substring search.

import { resolveAgentId } from "@re-cinq/lore-shared";
import {
  memoriesPath,
  isExpired,
  readJson,
  appendAudit,
  type MemoryRecord,
  type MemoryListEntry,
  type SearchResult,
} from "./memory-file-core.js";

export function listMemoriesFile(
  agentId?: string,
  limit: number = 50,
  offset: number = 0,
): { memories: MemoryListEntry[]; total: number } {
  const id = resolveAgentId(agentId);
  const memories = readJson<Record<string, MemoryRecord>>(memoriesPath(id), {});

  const active = activeEntries(memories, id);

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

/** The live entries, newest first. Deleted and expired records stay on disk — the store never rewrites a file to drop one — so every reader filters them out itself. */
function activeEntries(
  memories: Record<string, MemoryRecord>,
  id: string,
): MemoryListEntry[] {
  const active: MemoryListEntry[] = [];

  for (const [key, record] of Object.entries(memories)) {
    if (!record.is_deleted && !isExpired(record)) {
      active.push(listEntry(key, record, id));
    }
  }
  active.sort((a, b) => b.created_at.localeCompare(a.created_at));

  return active;
}

// One record as a list entry. `repo` and `has_facts` are always null/false in file mode — the file store holds no repo scoping and extracts no facts, and saying so plainly beats leaving the caller to infer it from a missing field.
function listEntry(
  key: string,
  record: MemoryRecord,
  id: string,
): MemoryListEntry {
  return {
    key,
    agent_id: id,
    repo: null,
    version: record.version,
    created_at: record.created_at,
    ttl_seconds: record.ttl_seconds,
    has_facts: false,
  };
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
      results.push(searchHit(key, record, agentId));
    }

    if (results.length >= limit) {
      break;
    }
  }

  return results;
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
    includesCaseless(key, lowerQuery) ||
    includesCaseless(record.value, lowerQuery)
  );
}

function includesCaseless(text: string, lowerQuery: string): boolean {
  return text.toLowerCase().includes(lowerQuery);
}

// One match. Score is a flat 1.0 — file mode matches on substring, so every hit is equally good and pretending otherwise would rank them by nothing.
function searchHit(
  key: string,
  record: MemoryRecord,
  agentId: string,
): SearchResult {
  return {
    key,
    value: record.value,
    version: record.version,
    score: 1.0,
    agent_id: agentId,
    created_at: record.created_at,
    source: "memory",
  };
}
