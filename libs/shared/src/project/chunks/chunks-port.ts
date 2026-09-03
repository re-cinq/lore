/** A chunk row to insert into `{schema}.chunks`; embedding is set separately via {@link ChunksPort.setEmbedding}. */
export interface ChunkInsert {
  content: string;
  contentType: string;
  team: string;
  repo: string;
  filePath: string;
  metadata: Record<string, unknown>;
}

/** A spec-chunk read row (the repo's resolved schema, `content_type = 'spec'`). */
export interface SpecChunkRow {
  id: string;
  repo: string;
  filePath: string;
  content: string;
}

/** A code symbol read row (`content_type = 'code'` with a `symbol_name`). */
export interface CodeSymbolRow {
  symbolName: string;
  symbolType: string | null;
  filePath: string;
}

/** A spec chunk with its ingest stamp; `chunkIndex` is null on legacy rows ingested before the chunker stamped it. */
export interface SpecChunkWithIngest {
  repo: string;
  filePath: string;
  content: string;
  ingestedAt: string | Date;
  chunkIndex: number | null;
}

/** A test-code chunk's line range (`metadata.start_line`/`end_line`) for link resolution. */
export interface TestChunkRange {
  filePath: string;
  startLine: number | null;
  endLine: number | null;
  /** Last ingested/verified time — lets the validate job tell index lag apart from genuine anchor rot. */
  ingestedAt: string | Date | null;
}

/** A spec chunk carrying its raw embedding (backfill similarity selection). */
export interface SpecChunkWithEmbedding extends SpecChunkWithIngest {
  embedding: unknown;
}

/** A code chunk with full content + metadata + embedding (backfill candidate selection). */
export interface CodeChunkFull {
  filePath: string;
  content: string;
  metadata: Record<string, unknown> | null;
  embedding: unknown;
}

/** The vector-store `chunks` surface: schema-per-team `{schema}.chunks` (interpolated, validated against `SCHEMA_RE`) plus the fixed `org_shared.chunks`. */
export interface ChunksPort {
  /** `SELECT schema_name FROM information_schema.schemata WHERE schema_name = $1` */
  schemaExists(schema: string): Promise<boolean>;

  /** `SELECT count(*) FROM ${schema}.chunks WHERE repo = $1` */
  countChunks(schema: string, repo: string): Promise<number>;

  /** `DELETE FROM ${schema}.chunks WHERE file_path = $1 AND repo = $2` */
  deleteChunksForFile(
    schema: string,
    filePath: string,
    repo: string,
  ): Promise<void>;

  /** `INSERT INTO ${schema}.chunks (...) VALUES (...) RETURNING id`; returns `null` when the insert returned no row. */
  insertChunk(schema: string, chunk: ChunkInsert): Promise<string | null>;

  /** `UPDATE ${schema}.chunks SET embedding = $1::vector WHERE id = $2`; caller passes an already-formatted `"[0.1,0.2,...]"` string. */
  setEmbedding(
    schema: string,
    chunkId: string,
    embedding: string,
  ): Promise<void>;

  /** `SELECT DISTINCT team FROM org_shared.chunks WHERE team IS NOT NULL` */
  distinctTeams(): Promise<string[]>;

  /** `SELECT COUNT(*) FROM org_shared.chunks WHERE team = $1` */
  countChunksByTeam(team: string): Promise<number>;

  // ── detection/coverage jobs read the repo's RESOLVED schema (team schema, else org_shared); the pod-side HTTP adapter proxies these so a station never needs a DB. ──

  /** Spec chunks for a repo (`content_type = 'spec'`) from its resolved schema, ordered by file path. */
  specChunks(repo: string): Promise<SpecChunkRow[]>;

  /** Code symbols for a repo (`content_type = 'code'`, `metadata->>'symbol_name'` set), from its resolved schema. */
  codeSymbols(repo: string): Promise<CodeSymbolRow[]>;

  /** True when the repo has at least one chunk of `contentType` in its resolved schema; backs gap-detect's missing-doc existence checks. */
  hasChunk(
    repo: string,
    contentType: string,
    fileSuffix?: string,
  ): Promise<boolean>;

  /** Count of the repo's reindex-owned chunks whose `ingested_at` exceeds `olderThanDays`; non-zero means reindex hasn't verified the repo recently. */
  staleChunkCount(repo: string, olderThanDays: number): Promise<number>;

  /** Spec chunks (with ingest stamp) for a repo, from its resolved schema, ordered by file path then chunk index. */
  specChunksWithIngest(repo: string): Promise<SpecChunkWithIngest[]>;

  /** Test-code chunk line ranges for a repo, from its resolved schema. */
  testChunkRanges(repo: string): Promise<TestChunkRange[]>;

  /** Spec chunks with embeddings for a repo, from its resolved schema (backfill), same ordering as {@link specChunksWithIngest}. */
  specChunksForBackfill(repo: string): Promise<SpecChunkWithEmbedding[]>;

  /** Code chunks (content + metadata + embedding) for a repo, from its resolved schema (backfill). */
  codeChunksForBackfill(repo: string): Promise<CodeChunkFull[]>;

  // ── Floor-only reindex verification surface (re-stamp/prune reindex-owned rows only); the station HTTP adapter throws on all three. ──

  /** Distinct `file_path`s of the repo's reindex-owned chunks in `${schema}.chunks`. */
  reindexOwnedFilePaths(schema: string, repo: string): Promise<string[]>;

  /** Distinct `file_path`s of ALL the repo's chunks regardless of `ingested_by` (issue #999) — the reindex backfill sweep uses this to avoid re-owning files other writers cover. */
  chunkedFilePaths(schema: string, repo: string): Promise<string[]>;

  /** Distinct `file_path`s of code chunks whose `chunker_version` is stale, capped at `limit`; the reindex heal sweep re-ingests these to propagate a chunker upgrade. */
  staleChunkerFiles(
    schema: string,
    repo: string,
    version: number,
    limit: number,
  ): Promise<string[]>;

  /** Re-stamp `ingested_at` to `NOW()` on reindex-owned chunks for `filePaths` whose oldest chunk exceeds `minAgeDays`, whole files at a time; returns rows updated. */
  touchChunksForFiles(
    schema: string,
    repo: string,
    filePaths: string[],
    minAgeDays: number,
  ): Promise<number>;

  /** Delete the repo's reindex-owned chunks for `filePaths` (orphans of files deleted from the repo); returns rows deleted. */
  pruneChunksForFiles(
    schema: string,
    repo: string,
    filePaths: string[],
  ): Promise<number>;

  /** MOVE the repo's legacy `org_shared.chunks` rows into `${schema}.chunks` (migration 0035, issue #979), per-file dedupe, idempotent; throws when `schema` is `org_shared`. */
  relocateLegacyChunks(
    schema: string,
    repo: string,
  ): Promise<{ moved: number; dropped: number }>;
}
