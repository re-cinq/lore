import { ReindexChunkStore } from "./chunks-memory-reindex.js";
import { enforceSchema, type ChunkRow } from "./chunk-row-memory.js";
import type {
  ChunksPort,
  ChunkInsert,
  SpecChunkRow,
  CodeSymbolRow,
  SpecChunkWithIngest,
  TestChunkRange,
  SpecChunkWithEmbedding,
  CodeChunkFull,
} from "./chunks-port.js";

export { enforceSchema, type ChunkRow } from "./chunk-row-memory.js";

function chunkIndexOf(row: ChunkRow): number | null {
  return (row.metadata.chunk_index as number | undefined) ?? null;
}

/** Mirrors the Pg adapter's spec-read ordering: file_path, chunk_index NULLS LAST, ingested_at. */
function specDocumentOrder(a: ChunkRow, b: ChunkRow): number {
  const pathDelta = a.filePath.localeCompare(b.filePath);

  if (pathDelta !== 0) {
    return pathDelta;
  }
  const aIndex = chunkIndexOf(a) ?? Number.POSITIVE_INFINITY;
  const bIndex = chunkIndexOf(b) ?? Number.POSITIVE_INFINITY;

  if (aIndex !== bIndex) {
    return aIndex < bIndex ? -1 : 1;
  }

  return new Date(a.ingestedAt).getTime() - new Date(b.ingestedAt).getTime();
}

/** In-memory ChunksPort — behavioral spec of the Pg adapter over rows keyed by (schema, repo, file_path, id); lets reindex/context-core jobs test without a live {schema}.chunks table. */
export class InMemoryChunks implements ChunksPort {
  private seq = 0;
  private readonly reindex: ReindexChunkStore;

  constructor(
    public rows: ChunkRow[] = [],
    public schemas: Set<string> = new Set(["org_shared"]),
  ) {
    this.reindex = new ReindexChunkStore(this);
  }

  async schemaExists(schema: string): Promise<boolean> {
    return this.schemas.has(schema);
  }

  async countChunks(schema: string, repo: string): Promise<number> {
    enforceSchema(schema);

    return this.rows.filter((row) => row.schema === schema && row.repo === repo)
      .length;
  }

  async deleteChunksForFile(
    schema: string,
    filePath: string,
    repo: string,
  ): Promise<void> {
    enforceSchema(schema);
    this.rows = this.rows.filter(
      (row) =>
        !(
          row.schema === schema &&
          row.filePath === filePath &&
          row.repo === repo
        ),
    );
  }

  async insertChunk(
    schema: string,
    chunk: ChunkInsert,
  ): Promise<string | null> {
    enforceSchema(schema);
    const id = String(++this.seq);

    this.rows.push({
      id,
      schema,
      content: chunk.content,
      contentType: chunk.contentType,
      team: chunk.team,
      repo: chunk.repo,
      filePath: chunk.filePath,
      metadata: chunk.metadata,
      embedding: null,
      ingestedAt: new Date().toISOString(),
    });

    return id;
  }

  async setEmbedding(
    schema: string,
    chunkId: string,
    embedding: string,
  ): Promise<void> {
    enforceSchema(schema);
    const row = this.rows.find(
      (candidate) => candidate.schema === schema && candidate.id === chunkId,
    );

    if (row) {
      row.embedding = embedding;
    }
  }

  async distinctTeams(): Promise<string[]> {
    const teams = new Set<string>();

    for (const row of this.rows) {
      if (row.schema === "org_shared" && row.team != null) {
        teams.add(row.team);
      }
    }

    return Array.from(teams);
  }

  async countChunksByTeam(team: string): Promise<number> {
    return this.rows.filter(
      (row) => row.schema === "org_shared" && row.team === team,
    ).length;
  }

  async specChunks(repo: string): Promise<SpecChunkRow[]> {
    return this.forRepo(repo)
      .filter((row) => row.contentType === "spec")
      .sort((a, b) => a.filePath.localeCompare(b.filePath))
      .map((row) => ({
        id: row.id,
        repo: row.repo,
        filePath: row.filePath,
        content: row.content,
      }));
  }

  async codeSymbols(repo: string): Promise<CodeSymbolRow[]> {
    return this.forRepo(repo)
      .filter(
        (row) =>
          row.contentType === "code" &&
          typeof row.metadata.symbol_name === "string",
      )
      .filter((row) => row.metadata.symbol_type !== "call")
      .map((row) => ({
        symbolName: row.metadata.symbol_name as string,
        symbolType: (row.metadata.symbol_type as string | undefined) ?? null,
        filePath: row.filePath,
      }));
  }

  async hasChunk(
    repo: string,
    contentType: string,
    fileSuffix?: string,
  ): Promise<boolean> {
    return this.forRepo(repo).some(
      (row) =>
        row.contentType === contentType &&
        (!fileSuffix || row.filePath.endsWith(fileSuffix)),
    );
  }

  staleChunkCount(repo: string, olderThanDays: number): Promise<number> {
    return this.reindex.staleChunkCount(repo, olderThanDays);
  }

  // Double stores a repo's chunks in one schema, so "resolved schema" reads are just repo-scoped reads across whatever schema the fixture used.
  private forRepo(repo: string): ChunkRow[] {
    return this.rows.filter((row) => row.repo === repo);
  }

  async specChunksWithIngest(repo: string): Promise<SpecChunkWithIngest[]> {
    return this.forRepo(repo)
      .filter((row) => row.contentType === "spec")
      .sort(specDocumentOrder)
      .map((row) => ({
        repo: row.repo,
        filePath: row.filePath,
        content: row.content,
        ingestedAt: row.ingestedAt,
        chunkIndex: chunkIndexOf(row),
      }));
  }

  async testChunkRanges(repo: string): Promise<TestChunkRange[]> {
    return this.forRepo(repo)
      .filter((row) => row.contentType === "code")
      .map((row) => ({
        filePath: row.filePath,
        startLine: (row.metadata.start_line as number | undefined) ?? null,
        endLine: (row.metadata.end_line as number | undefined) ?? null,
        ingestedAt: row.ingestedAt,
      }));
  }

  async specChunksForBackfill(repo: string): Promise<SpecChunkWithEmbedding[]> {
    return this.forRepo(repo)
      .filter((row) => row.contentType === "spec")
      .sort(specDocumentOrder)
      .map((row) => ({
        repo: row.repo,
        filePath: row.filePath,
        content: row.content,
        ingestedAt: row.ingestedAt,
        chunkIndex: chunkIndexOf(row),
        embedding: row.embedding,
      }));
  }

  async codeChunksForBackfill(repo: string): Promise<CodeChunkFull[]> {
    return this.forRepo(repo)
      .filter((row) => row.contentType === "code")
      .map((row) => ({
        filePath: row.filePath,
        content: row.content,
        metadata: row.metadata,
        embedding: row.embedding,
      }));
  }

  reindexOwnedFilePaths(schema: string, repo: string): Promise<string[]> {
    return this.reindex.reindexOwnedFilePaths(schema, repo);
  }

  chunkedFilePaths(schema: string, repo: string): Promise<string[]> {
    return this.reindex.chunkedFilePaths(schema, repo);
  }

  staleChunkerFiles(
    schema: string,
    repo: string,
    version: number,
    limit: number,
  ): Promise<string[]> {
    return this.reindex.staleChunkerFiles(schema, repo, version, limit);
  }

  touchChunksForFiles(
    schema: string,
    repo: string,
    filePaths: string[],
    minAgeDays: number,
  ): Promise<number> {
    return this.reindex.touchChunksForFiles(
      schema,
      repo,
      filePaths,
      minAgeDays,
    );
  }

  pruneChunksForFiles(
    schema: string,
    repo: string,
    filePaths: string[],
  ): Promise<number> {
    return this.reindex.pruneChunksForFiles(schema, repo, filePaths);
  }

  relocateLegacyChunks(
    schema: string,
    repo: string,
  ): Promise<{ moved: number; dropped: number }> {
    return this.reindex.relocateLegacyChunks(schema, repo);
  }
}
