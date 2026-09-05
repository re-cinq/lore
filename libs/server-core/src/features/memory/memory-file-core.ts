// Shared primitives for the file-backed memory store: paths, JSON I/O, audit, and wire types. Neither memory-file.ts nor its siblings import each other for these — both import here instead, breaking the cycle a straight split would leave behind.

import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  appendFileSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { randomUUID } from "node:crypto";

// ── Paths ────────────────────────────────────────────────────────────

export const BASE_DIR = join(process.env.HOME || "/tmp", ".lore", "memory");
const AUDIT_FILE = join(BASE_DIR, "audit.jsonl");

export function agentDir(agentId: string): string {
  return join(BASE_DIR, agentId);
}

export function memoriesPath(agentId: string): string {
  return join(agentDir(agentId), "memories.json");
}

// ── Types ────────────────────────────────────────────────────────────

// The on-disk memories.json record; snake_case mirrors memory.ts's raw pg-row output, this backend's parity contract.
// eslint-disable-next-line lore/no-row-types-outside-models
export interface MemoryRecord {
  value: string;
  version: number;
  created_at: string;
  ttl_seconds: number | null;
  is_deleted: boolean;
  expires_at: string | null;
}

export interface WriteResult {
  key: string;
  version: number;
  agent_id: string;
  created_at: string;
}

// The read/search wire response; snake_case matches memory.ts's raw pg-row output, this backend's parity contract.
// eslint-disable-next-line lore/no-row-types-outside-models
export interface MemoryEntry {
  key: string;
  value: string;
  version: number;
  created_at: string;
  ttl_seconds: number | null;
  is_deleted: boolean;
  expires_at: string | null;
}

// What a LISTING answers — the pool path's projection, field for field: no `value` (a page of full values is a page of whole documents), `repo`/`has_facts` stated as the null/false this store can honestly answer.
// eslint-disable-next-line lore/no-row-types-outside-models
export interface MemoryListEntry {
  key: string;
  agent_id: string;
  repo: string | null;
  version: number;
  created_at: string;
  ttl_seconds: number | null;
  has_facts: boolean;
}

export interface SearchResult {
  key: string;
  value: string;
  version: number;
  score: number;
  agent_id: string;
  created_at: string;
  // Always "memory": this store holds nothing else, but the endpoint declares one shape for both backends (the pool path also answers facts/episodes/graph hits).
  source: "memory";
}

// ── Safe JSON read / write ───────────────────────────────────────────

function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

export function readJson<T>(filePath: string, fallback: T): T {
  try {
    if (!existsSync(filePath)) {
      return fallback;
    }
    const raw = readFileSync(filePath, "utf-8");

    return JSON.parse(raw) as T;
  } catch {
    // Corrupted JSON — reset to fallback
    return fallback;
  }
}

export function writeJson(filePath: string, value: unknown): void {
  ensureDir(dirname(filePath));
  writeFileSync(filePath, JSON.stringify(value, null, 2) + "\n", "utf-8");
}

// ── Audit log ────────────────────────────────────────────────────────

// The audit.jsonl entry shape; snake_case mirrors memory.audit_log's raw pg-row output (models/memory-audit-entry.ts).
// eslint-disable-next-line lore/no-row-types-outside-models
interface AuditEntry {
  id: string;
  agent_id: string;
  operation: string;
  memory_key: string | null;
  pool_name: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export function appendAudit(
  entry: Omit<AuditEntry, "id" | "created_at">,
): void {
  ensureDir(BASE_DIR);
  const full: AuditEntry = {
    id: randomUUID(),
    created_at: new Date().toISOString(),
    ...entry,
  };

  try {
    appendFileSync(AUDIT_FILE, JSON.stringify(full) + "\n", "utf-8");
  } catch {
    // Best-effort — don't fail the operation if audit write fails
  }
}

// ── Expiration helper ────────────────────────────────────────────────

export function isExpired(record: MemoryRecord): boolean {
  if (!record.expires_at) {
    return false;
  }

  return new Date(record.expires_at) <= new Date();
}

// ── Active-entry projection ──────────────────────────────────────────

/** The record as a MemoryEntry, or null when it is absent, deleted, or expired. */
export function activeMemoryEntry(
  key: string,
  record: MemoryRecord | undefined,
): MemoryEntry | null {
  if (!record || record.is_deleted || isExpired(record)) {
    return null;
  }

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
