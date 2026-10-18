// The memory.* rows the Utopia memory mirror pushes (specs/utopia-graph-mirror FR16): one key's rows as Lore's write found them, and a base's rows above the walk's cursor, each with its mirror sequence number (migration 0110).

import type { Pool } from "pg";
import {
  episodeDocument,
  memoryDocument,
  type IngestDocument,
  type MirroredMemory,
} from "@re-cinq/lore-shared/utopia/memory-documents.js";
import type { MemoryBase } from "./utopia-memory-sources.js";

/** The onboarded repo's name as Lore holds it, or null when Lore holds no such repo. */
export async function onboardedRepo(
  pool: Pool,
  repo: string,
): Promise<string | null> {
  const { rows } = await pool.query<{ full_name: string }>(
    "SELECT full_name FROM lore.repos WHERE lower(full_name) = lower($1)",
    [repo],
  );

  return rows.at(0)?.full_name ?? null;
}

interface MemoryRow {
  seq: string;
  agent_id: string;
  key: string;
  value: string;
  repo: string | null;
  created_at: string;
  live: boolean;
}

export interface StoredMemory extends MirroredMemory {
  repo: string | null;
}

/** Only a key's newest version is the memory; an older version row left behind is not pushed over it. */
const MEMORY_SELECT = `SELECT m.mirror_seq::text AS seq, m.agent_id, m.key, m.value, m.repo,
         to_json(m.created_at) #>> '{}' AS created_at,
         (NOT m.is_deleted AND (m.expires_at IS NULL OR m.expires_at > now())) AS live
    FROM memory.memories m
   WHERE NOT EXISTS (SELECT 1 FROM memory.memories newer
                      WHERE newer.agent_id = m.agent_id AND newer.key = m.key AND newer.version > m.version)`;

/** The rows of one key as Lore's write found them: by repo for a repo's memory, by agent for an agent's own. */
export async function memoriesNamed(
  pool: Pool,
  named: { key: string; repo?: string; agentId?: string },
): Promise<StoredMemory[]> {
  const [column, value] = named.repo
    ? ["m.repo", named.repo]
    : ["m.agent_id", named.agentId];
  const { rows } = await pool.query<MemoryRow>(
    `${MEMORY_SELECT} AND ${column} = $1 AND m.key = $2`,
    [value, named.key],
  );

  return rows.map(storedMemory);
}

function storedMemory(row: MemoryRow): StoredMemory {
  return {
    agentId: row.agent_id,
    key: row.key,
    value: row.value,
    repo: row.repo,
    createdAt: row.created_at,
    live: row.live,
  };
}

/** What the walk pushes for one row: its sequence number, as text since a bigint outgrows a JS number's safe range, and its document. */
export interface SequencedDocument {
  seq: string;
  document: IngestDocument;
}

export interface RowsPage {
  after: string | null;
  limit: number;
}

/** The base's memories above `after`, lowest sequence number first. */
export async function memoryRowsAbove(
  pool: Pool,
  base: MemoryBase,
  page: RowsPage,
): Promise<SequencedDocument[]> {
  const { rows } = await pool.query<MemoryRow>(
    `${MEMORY_SELECT} AND m.mirror_seq > $1::bigint AND ${scopeOf(base, "m.repo")}
     ORDER BY m.mirror_seq LIMIT $2`,
    pageParams(base, page),
  );

  return rows.map((row) => ({
    seq: row.seq,
    document: memoryDocument(storedMemory(row)),
  }));
}

interface EpisodeRow {
  seq: string;
  id: string;
  content: string;
  created_at: string;
}

/** The base's episodes above `after`, lowest sequence number first; an episode's ref is the repo it came from. */
export async function episodeRowsAbove(
  pool: Pool,
  base: MemoryBase,
  page: RowsPage,
): Promise<SequencedDocument[]> {
  const { rows } = await pool.query<EpisodeRow>(
    `SELECT e.mirror_seq::text AS seq, e.id, e.content, to_json(e.created_at) #>> '{}' AS created_at
       FROM memory.episodes e
      WHERE e.mirror_seq > $1::bigint AND ${scopeOf(base, "e.ref")}
      ORDER BY e.mirror_seq LIMIT $2`,
    pageParams(base, page),
  );

  return rows.map((row) => ({
    seq: row.seq,
    document: episodeDocument({ ...row, createdAt: row.created_at }),
  }));
}

/** A repo's rows by their repo; the org base's are those with none, or with a repo Lore does not hold. */
function scopeOf(base: MemoryBase, column: string): string {
  return base.repo
    ? `lower(${column}) = lower($3)`
    : `(${column} IS NULL OR NOT EXISTS (SELECT 1 FROM lore.repos r WHERE lower(r.full_name) = lower(${column})))`;
}

function pageParams(base: MemoryBase, page: RowsPage): (string | number)[] {
  const params = [page.after ?? "0", page.limit];

  return base.repo ? [...params, base.name] : params;
}
