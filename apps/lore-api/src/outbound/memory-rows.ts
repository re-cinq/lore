// The memory.* rows the Utopia memory mirror pushes (specs/utopia-graph-mirror FR16): one key's rows as Lore's write found them, a base's episodes after the walk's cursor in insert order, and a base's memories after it in id order, each with the cursor it leaves.

import type { Pool } from "pg";
import {
  episodeDocument,
  memoryDocument,
  REF_REPO_PATTERN,
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
  id: string;
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
const MEMORY_SELECT = `SELECT m.id, m.agent_id, m.key, m.value, m.repo,
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

/** What the walk pushes for one row, and the cursor it leaves once that row has landed. */
export interface CursoredDocument {
  cursor: string;
  document: IngestDocument;
}

export interface RowsPage {
  after: string | null;
  limit: number;
}

/** The base's memories after the id `after`, in id order: a pass over every memory, live or dead, that the walk starts again once it reaches the end. */
export async function memoryRowsAfter(
  pool: Pool,
  base: MemoryBase,
  page: RowsPage,
): Promise<CursoredDocument[]> {
  const { rows } = await pool.query<MemoryRow>(
    `${MEMORY_SELECT} AND ($1::uuid IS NULL OR m.id > $1::uuid) AND ${scopeOf(base, "m.repo", 3)}
     ORDER BY m.id LIMIT $2`,
    [page.after, page.limit, ...repoParam(base)],
  );

  return rows.map((row) => ({
    cursor: row.id,
    document: memoryDocument(storedMemory(row)),
  }));
}

interface EpisodeRow {
  id: string;
  content: string;
  created_at: string;
}

/** The base's episodes after the cursor `<created_at>|<id>`, oldest first; episodes are never changed once inserted, so one pass holds them all. An episode's ref is the repo it came from. */
export async function episodeRowsAfter(
  pool: Pool,
  base: MemoryBase,
  page: RowsPage,
): Promise<CursoredDocument[]> {
  const [at, id] = page.after?.split("|") ?? [null, null];
  const { rows } = await pool.query<EpisodeRow>(
    `SELECT e.id, e.content, to_json(e.created_at) #>> '{}' AS created_at
       FROM memory.episodes e
      WHERE ($1::timestamptz IS NULL OR (e.created_at, e.id) > ($1::timestamptz, $2::uuid))
        AND e.created_at > now() - interval '${EPISODE_WINDOW}'
        AND ${scopeOf(base, EPISODE_REPO, 4)}
      ORDER BY e.created_at, e.id LIMIT $3`,
    [at, id, page.limit, ...repoParam(base)],
  );

  return rows.map((row) => ({
    cursor: `${row.created_at}|${row.id}`,
    document: episodeDocument({ ...row, createdAt: row.created_at }),
  }));
}

// Utopia extracts about two documents a minute, so the walk mirrors the episodes still worth reading, not every session ever dumped; a new one is pushed as it is written.
const EPISODE_WINDOW = "90 days";

// The repo an episode's ref names, read with the live push's pattern (a constant, never input).
const EPISODE_REPO = `substring(e.ref from '${REF_REPO_PATTERN}')`;

/** A repo's rows by their repo; the org base's are those with none, or with a repo Lore does not hold. */
function scopeOf(base: MemoryBase, column: string, repoAt: number): string {
  return base.repo
    ? `lower(${column}) = lower($${repoAt})`
    : `(${column} IS NULL OR NOT EXISTS (SELECT 1 FROM lore.repos r WHERE lower(r.full_name) = lower(${column})))`;
}

function repoParam(base: MemoryBase): string[] {
  return base.repo ? [base.name] : [];
}
