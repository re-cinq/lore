/**
 * File-backed fallback for memory operations (T007).
 *
 * When PostgreSQL is unavailable, all memory tools fall back to this module.
 * Same function signatures as memory.ts but uses JSON files in ~/.lore/memory/.
 *
 * Directory structure:
 *   ~/.lore/memory/
 *     <agent-id>/
 *       memories.json    – { [key]: MemoryRecord }
 *       versions.json    – { [key]: VersionRecord[] }
 *     shared/
 *       <pool-name>/
 *         memories.json
 *     audit.jsonl        – append-only, one JSON per line
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, appendFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { resolveAgentId } from './agent-id.js';

// ── Paths ────────────────────────────────────────────────────────────

const BASE_DIR = join(process.env.HOME || '/tmp', '.lore', 'memory');
const AUDIT_FILE = join(BASE_DIR, 'audit.jsonl');

function agentDir(agentId: string): string {
  return join(BASE_DIR, agentId);
}

function memoriesPath(agentId: string): string {
  return join(agentDir(agentId), 'memories.json');
}

function versionsPath(agentId: string): string {
  return join(agentDir(agentId), 'versions.json');
}

// ── Types ────────────────────────────────────────────────────────────

export interface MemoryRecord {
  value: string;
  version: number;
  created_at: string;
  ttl_seconds: number | null;
  is_deleted: boolean;
  expires_at: string | null;
}

export interface VersionRecord {
  version: number;
  value: string;
  created_at: string;
}

export interface WriteResult {
  key: string;
  version: number;
  agent_id: string;
  created_at: string;
}

export interface MemoryEntry {
  key: string;
  value: string;
  version: number;
  created_at: string;
  ttl_seconds: number | null;
  is_deleted: boolean;
  expires_at: string | null;
}

export interface SearchResult {
  key: string;
  value: string;
  version: number;
  score: number;
  agent_id: string;
  created_at: string;
}

// ── Safe JSON read / write ───────────────────────────────────────────

function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function readJson<T>(filePath: string, fallback: T): T {
  try {
    if (!existsSync(filePath)) return fallback;
    const raw = readFileSync(filePath, 'utf-8');
    return JSON.parse(raw) as T;
  } catch {
    // Corrupted JSON — reset to fallback
    return fallback;
  }
}

function writeJson(filePath: string, data: unknown): void {
  ensureDir(dirname(filePath));
  writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
}

// ── Audit log ────────────────────────────────────────────────────────

interface AuditEntry {
  id: string;
  agent_id: string;
  operation: string;
  memory_key: string | null;
  pool_name: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

function appendAudit(entry: Omit<AuditEntry, 'id' | 'created_at'>): void {
  ensureDir(BASE_DIR);
  const full: AuditEntry = {
    id: randomUUID(),
    created_at: new Date().toISOString(),
    ...entry,
  };
  try {
    appendFileSync(AUDIT_FILE, JSON.stringify(full) + '\n', 'utf-8');
  } catch {
    // Best-effort — don't fail the operation if audit write fails
  }
}

// ── Expiration helper ────────────────────────────────────────────────

function isExpired(record: MemoryRecord): boolean {
  if (!record.expires_at) return false;
  return new Date(record.expires_at) <= new Date();
}

// ── Write ────────────────────────────────────────────────────────────

export function writeMemoryFile(
  key: string,
  value: string,
  agentId?: string,
  ttlSeconds?: number,
): WriteResult {
  const id = resolveAgentId(agentId);
  const now = new Date().toISOString();
  const expiresAt = ttlSeconds ? new Date(Date.now() + ttlSeconds * 1000).toISOString() : null;

  // Read current state
  const memories = readJson<Record<string, MemoryRecord>>(memoriesPath(id), {});
  const versions = readJson<Record<string, VersionRecord[]>>(versionsPath(id), {});

  // Determine version
  const existing = memories[key];
  const nextVersion = existing && !existing.is_deleted ? existing.version + 1 : 1;

  // Update memory record (last-write-wins)
  memories[key] = {
    value,
    version: nextVersion,
    created_at: now,
    ttl_seconds: ttlSeconds ?? null,
    is_deleted: false,
    expires_at: expiresAt,
  };

  // Append version history
  if (!versions[key]) versions[key] = [];
  versions[key].push({
    version: nextVersion,
    value,
    created_at: now,
  });

  // Persist
  writeJson(memoriesPath(id), memories);
  writeJson(versionsPath(id), versions);

  // Audit
  appendAudit({
    agent_id: id,
    operation: 'write',
    memory_key: key,
    pool_name: null,
    metadata: { version: nextVersion, ttl_seconds: ttlSeconds ?? null },
  });

  return { key, version: nextVersion, agent_id: id, created_at: now };
}

// ── Read ─────────────────────────────────────────────────────────────

export function readMemoryFile(
  key: string,
  agentId?: string,
  version?: number | 'all',
): MemoryEntry | VersionRecord[] | null {
  const id = resolveAgentId(agentId);

  // Audit
  appendAudit({
    agent_id: id,
    operation: 'read',
    memory_key: key,
    pool_name: null,
    metadata: { version: version ?? 'latest' },
  });

  // Return full version history
  if (version === 'all') {
    const versions = readJson<Record<string, VersionRecord[]>>(versionsPath(id), {});
    const history = versions[key];
    if (!history || history.length === 0) return null;
    // Return sorted by version descending (newest first)
    return [...history].sort((a, b) => b.version - a.version);
  }

  // Return a specific version
  if (typeof version === 'number') {
    const versions = readJson<Record<string, VersionRecord[]>>(versionsPath(id), {});
    const history = versions[key];
    if (!history) return null;
    const match = history.find(v => v.version === version);
    if (!match) return null;
    return {
      key,
      value: match.value,
      version: match.version,
      created_at: match.created_at,
      ttl_seconds: null,
      is_deleted: false,
      expires_at: null,
    };
  }

  // Return latest version
  const memories = readJson<Record<string, MemoryRecord>>(memoriesPath(id), {});
  const record = memories[key];
  if (!record || record.is_deleted || isExpired(record)) return null;

  return {
    key,
    value: record.value,
    version: record.version,
    created_at: record.created_at,
    ttl_seconds: record.ttl_seconds,
    is_deleted: record.is_deleted,
    expires_at: record.expires_at,
  };
}

// ── Delete (soft-delete) ─────────────────────────────────────────────

export function deleteMemoryFile(
  key: string,
  agentId?: string,
): { key: string; deleted: boolean } {
  const id = resolveAgentId(agentId);
  const memories = readJson<Record<string, MemoryRecord>>(memoriesPath(id), {});

  const record = memories[key];
  if (!record || record.is_deleted) {
    return { key, deleted: false };
  }

  record.is_deleted = true;
  writeJson(memoriesPath(id), memories);

  appendAudit({
    agent_id: id,
    operation: 'delete',
    memory_key: key,
    pool_name: null,
    metadata: null,
  });

  return { key, deleted: true };
}

// ── List ─────────────────────────────────────────────────────────────

export function listMemoriesFile(
  agentId?: string,
  limit: number = 50,
  offset: number = 0,
): { memories: MemoryEntry[]; total: number } {
  const id = resolveAgentId(agentId);
  const memories = readJson<Record<string, MemoryRecord>>(memoriesPath(id), {});

  // Filter out deleted and expired entries
  const active: MemoryEntry[] = [];
  for (const [key, record] of Object.entries(memories)) {
    if (record.is_deleted || isExpired(record)) continue;
    active.push({
      key,
      value: record.value,
      version: record.version,
      created_at: record.created_at,
      ttl_seconds: record.ttl_seconds,
      is_deleted: record.is_deleted,
      expires_at: record.expires_at,
    });
  }

  // Sort by created_at descending (newest first)
  active.sort((a, b) => b.created_at.localeCompare(a.created_at));

  const total = active.length;
  const paged = active.slice(offset, offset + limit);

  appendAudit({
    agent_id: id,
    operation: 'list',
    memory_key: null,
    pool_name: null,
    metadata: { limit, offset, total },
  });

  return { memories: paged, total };
}

// ── Search (case-insensitive substring) ──────────────────────────────

export function searchMemoryFile(
  query: string,
  agentId?: string,
  limit: number = 10,
): SearchResult[] {
  const id = resolveAgentId(agentId);
  const memories = readJson<Record<string, MemoryRecord>>(memoriesPath(id), {});
  const lowerQuery = query.toLowerCase();

  const results: SearchResult[] = [];
  for (const [key, record] of Object.entries(memories)) {
    if (record.is_deleted || isExpired(record)) continue;
    if (
      key.toLowerCase().includes(lowerQuery) ||
      record.value.toLowerCase().includes(lowerQuery)
    ) {
      results.push({
        key,
        value: record.value,
        version: record.version,
        score: 1.0,
        agent_id: id,
        created_at: record.created_at,
      });
    }
    if (results.length >= limit) break;
  }

  appendAudit({
    agent_id: id,
    operation: 'search',
    memory_key: null,
    pool_name: null,
    metadata: { query, result_count: results.length },
  });

  return results;
}
