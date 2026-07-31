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

/** A spec chunk with its ingest stamp (coverage jobs reassemble + resolve links).
 * `chunkIndex` is `(metadata->>'chunk_index')::int` — the chunker's document
 * position, null on legacy rows ingested before the chunker stamped it. */
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
  /** When the chunk row was last ingested/verified — lets the validate job
   * tell index lag (file re-chunked before the spec linking into it) apart
   * from genuine anchor rot. */
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

/**
 * The vector-store `chunks` surface. Two table families live behind it:
 * schema-per-team `{schema}.chunks` (the `${schema}` name is interpolated, so
 * the Pg adapter validates it against `SCHEMA_RE` first) and the fixed
 * `org_shared.chunks` shared schema (no interpolation — only the team
 * aggregates read it directly). Single-sourced out of the Floor reindex /
 * context-core-builder jobs so the kernel never reaches a pg pool for chunk
 * reads/writes directly.
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

  // ── the detection (spec-drift, gap-detect) + coverage jobs read the repo's
  //    RESOLVED schema (team schema, else org_shared — where reindex actually
  //    wrote the repo's chunks), so these are repo-scoped and the adapter
  //    resolves the schema. The pod-side HTTP adapter maps specChunks/codeSymbols
  //    to `GET /api/repos/:o/:r/chunks?content_type=…`, so a station never needs a DB. ──

  /** Spec chunks for a repo (`content_type = 'spec'`) from its resolved schema, ordered by file path. */
  specChunks(repo: string): Promise<SpecChunkRow[]>;

  /** Code symbols for a repo (`content_type = 'code'`, `metadata->>'symbol_name'` set), from its resolved schema. */
  codeSymbols(repo: string): Promise<CodeSymbolRow[]>;

  /**
   * True when the repo has at least one chunk of `contentType` in its resolved
   * schema, optionally with a `file_path LIKE '%<fileSuffix>'`. Backs
   * gap-detect's missing-CLAUDE.md / ADR / spec existence checks.
   */
  hasChunk(
    repo: string,
    contentType: string,
    fileSuffix?: string,
  ): Promise<boolean>;

  /**
   * Count of the repo's reindex-owned chunks (`metadata->>'ingested_by' =
   * 'reindex-job'`) in its resolved schema whose `ingested_at` is more than
   * `olderThanDays` old (stale-content gap). The reindex verification pass
   * re-stamps `ingested_at` on every successful run, so a non-zero count means
   * reindex has not verified the repo recently — not merely that its files are
   * unchanged.
   */
  staleChunkCount(repo: string, olderThanDays: number): Promise<number>;

  /** Spec chunks (with ingest stamp) for a repo, from its resolved schema,
   * ordered `file_path, (metadata->>'chunk_index')::int NULLS LAST, ingested_at, id`. */
  specChunksWithIngest(repo: string): Promise<SpecChunkWithIngest[]>;

  /** Test-code chunk line ranges for a repo, from its resolved schema. */
  testChunkRanges(repo: string): Promise<TestChunkRange[]>;

  /** Spec chunks with embeddings for a repo, from its resolved schema
   * (backfill), same `chunk_index NULLS LAST` ordering as {@link specChunksWithIngest}. */
  specChunksForBackfill(repo: string): Promise<SpecChunkWithEmbedding[]>;

  /** Code chunks (content + metadata + embedding) for a repo, from its resolved schema (backfill). */
  codeChunksForBackfill(repo: string): Promise<CodeChunkFull[]>;

  // ── Floor-only reindex verification surface. The nightly reindex re-stamps
  //    chunks whose files still exist in the repo tree and prunes orphans of
  //    deleted files, restricted to rows it wrote itself
  //    (`metadata->>'ingested_by' = 'reindex-job'`). The station HTTP adapter
  //    throws on all three. ──

  /** Distinct `file_path`s of the repo's reindex-owned chunks in `${schema}.chunks`. */
  reindexOwnedFilePaths(schema: string, repo: string): Promise<string[]>;

  /**
   * Distinct `file_path`s of ALL the repo's chunks in `${schema}.chunks`,
   * regardless of `ingested_by` or content type. The reindex backfill sweep
   * diffs the repo tree against this set to find files that never ingested
   * (issue #999); including api/ui-ingested rows keeps the sweep from
   * re-ingesting — and thereby re-owning — files other writers already cover.
   */
  chunkedFilePaths(schema: string, repo: string): Promise<string[]>;

  /**
   * Distinct `file_path`s of the repo's code chunks in `${schema}.chunks`
   * whose `metadata->>'chunker_version'` is absent or older than `version`,
   * ordered by path and capped at `limit`. The reindex heal sweep re-ingests
   * these so a chunker upgrade propagates to files that never change; the cap
   * self-throttles the one-time re-embed across nightly runs.
   */
  staleChunkerFiles(
    schema: string,
    repo: string,
    version: number,
    limit: number,
  ): Promise<string[]>;

  /**
   * Re-stamp `ingested_at` to `NOW()` on the repo's reindex-owned chunks whose
   * `file_path` is in `filePaths`. Only files whose oldest chunk is more than
   * `minAgeDays` old are re-stamped — whole files at a time — keeping
   * steady-state nights from rewriting every row (each rewrite copies the
   * embedding into a new row version). Spec reassembly orders same-file chunks
   * by `metadata.chunk_index`, so one shared timestamp per sweep is safe.
   * Returns rows updated.
   */
  touchChunksForFiles(
    schema: string,
    repo: string,
    filePaths: string[],
    minAgeDays: number,
  ): Promise<number>;

  /**
   * Delete the repo's reindex-owned chunks whose `file_path` is in `filePaths`
   * (orphans of files deleted from the repo). Returns rows deleted.
   */
  pruneChunksForFiles(
    schema: string,
    repo: string,
    filePaths: string[],
  ): Promise<number>;

  /**
   * MOVE the repo's legacy rows out of `org_shared.chunks` into
   * `${schema}.chunks` (the runtime mirror of migration 0035, issue #979 —
   * a repo whose team schema comes into existence after ingestion would
   * otherwise leave its history stranded and invisible to every resolved-schema
   * read). Per-FILE dedupe: files already present in the target keep their
   * fresh copy and the stale org_shared rows are dropped; files absent move
   * wholesale, preserving id, embedding, and `ingested_at`, rewriting `team`
   * to the target schema, stamping `metadata.migrated_from = 'org_shared'`,
   * and adopting provenance-less rows with a classifyFile content type
   * (`doc`/`code`/`adr`/`spec`) via `ingested_by = 'reindex-job'`. Copy and
   * delete share one statement/snapshot — never a delete without a copy.
   * Idempotent; a clean repo is a no-op. Throws when `schema` is
   * `org_shared` — self-relocation would dedupe every row against itself and
   * delete the repo's chunks outright. Returns rows moved and rows removed
   * from org_shared (`dropped - moved` = stale duplicates discarded).
   */
  relocateLegacyChunks(
    schema: string,
    repo: string,
  ): Promise<{ moved: number; dropped: number }>;
}
