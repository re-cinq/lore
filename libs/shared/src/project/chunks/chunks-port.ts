/**
 * A chunk row to insert into `{schema}.chunks`. `metadata` is an already
 * JSON-serializable object — the adapter binds it via `JSON.stringify`, exactly
 * as the reindex job does. The embedding column is set separately via
 * {@link ChunksPort.setEmbedding} once the caller has formatted the vector.
 */
export interface ChunkInsert {
  content: string;
  contentType: string;
  team: string;
  repo: string;
  filePath: string;
  metadata: Record<string, unknown>;
}

/** A spec-chunk read row (`org_shared.chunks` where `content_type = 'spec'`). */
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

/** A spec chunk with its ingest stamp (coverage jobs reassemble + resolve links). */
export interface SpecChunkWithIngest {
  repo: string;
  filePath: string;
  content: string;
  ingestedAt: string | Date;
}

/** A test-code chunk's line range (`metadata.start_line`/`end_line`) for link resolution. */
export interface TestChunkRange {
  filePath: string;
  startLine: number | null;
  endLine: number | null;
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

/**
 * The vector-store `chunks` surface. Two table families live behind it:
 * schema-per-team `{schema}.chunks` (the `${schema}` name is interpolated, so
 * the Pg adapter validates it against `SCHEMA_RE` first) and the fixed
 * `org_shared.chunks` shared schema (no interpolation). Single-sourced out of
 * the Floor reindex / context-core-builder jobs so the kernel never reaches a
 * pg pool for chunk reads/writes directly.
 */
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

  /**
   * `INSERT INTO ${schema}.chunks (...) VALUES (...) RETURNING id`. Returns the
   * new row's id, or `null` when the insert returned no row.
   */
  insertChunk(schema: string, chunk: ChunkInsert): Promise<string | null>;

  /**
   * `UPDATE ${schema}.chunks SET embedding = $1::vector WHERE id = $2`. The
   * caller passes the already-formatted `"[0.1,0.2,...]"` string — the port
   * does not format the vector.
   */
  setEmbedding(
    schema: string,
    chunkId: string,
    embedding: string,
  ): Promise<void>;

  /** `SELECT DISTINCT team FROM org_shared.chunks WHERE team IS NOT NULL` */
  distinctTeams(): Promise<string[]>;

  /** `SELECT COUNT(*) FROM org_shared.chunks WHERE team = $1` */
  countChunksByTeam(team: string): Promise<number>;

  // ── org_shared reads for the detection jobs (spec-drift / gap-detect) ──
  // These read `org_shared.chunks` per repo; the pod-side HTTP adapter maps them
  // to `GET /api/repos/:o/:r/chunks?content_type=…`, so a station never needs a DB.

  /** Spec chunks for a repo (`content_type = 'spec'`), ordered by file path. */
  specChunks(repo: string): Promise<SpecChunkRow[]>;

  /** Code symbols for a repo (`content_type = 'code'`, `metadata->>'symbol_name'` set). */
  codeSymbols(repo: string): Promise<CodeSymbolRow[]>;

  /**
   * True when the repo has at least one chunk of `contentType`, optionally with a
   * `file_path LIKE '%<fileSuffix>'`. Backs gap-detect's missing-CLAUDE.md / ADR /
   * spec existence checks.
   */
  hasChunk(
    repo: string,
    contentType: string,
    fileSuffix?: string,
  ): Promise<boolean>;

  /** Count of the repo's chunks last ingested more than `olderThanDays` ago (stale-content gap). */
  staleChunkCount(repo: string, olderThanDays: number): Promise<number>;

  // ── the coverage jobs read the repo's RESOLVED schema (team schema, else
  //    org_shared — where reindex actually wrote the repo's chunks), so these
  //    are repo-scoped and the adapter resolves the schema. ──

  /** Spec chunks (with ingest stamp) for a repo, from its resolved schema. */
  specChunksWithIngest(repo: string): Promise<SpecChunkWithIngest[]>;

  /** Test-code chunk line ranges for a repo, from its resolved schema. */
  testChunkRanges(repo: string): Promise<TestChunkRange[]>;

  /** Spec chunks with embeddings for a repo, from its resolved schema (backfill). */
  specChunksForBackfill(repo: string): Promise<SpecChunkWithEmbedding[]>;

  /** Code chunks (content + metadata + embedding) for a repo, from its resolved schema (backfill). */
  codeChunksForBackfill(repo: string): Promise<CodeChunkFull[]>;
}
