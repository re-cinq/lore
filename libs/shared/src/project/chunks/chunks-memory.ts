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

/**
 * One stored chunk row in {@link InMemoryChunks}. Mirrors the columns the Pg
 * adapter writes, plus the formatted `embedding` string set after insert.
 */
export interface ChunkRow {
  id: string;
  schema: string;
  content: string;
  contentType: string;
  team: string;
  repo: string;
  filePath: string;
  metadata: Record<string, unknown>;
  embedding: string | null;
  /** Seedable ISO timestamp for the staleChunkCount age check (defaults to now). */
  ingestedAt: string;
}

const SCHEMA_RE = /^[a-z][a-z0-9_]+$/;

function enforceSchema(schema: string): void {
  if (!SCHEMA_RE.test(schema)) {
    throw new Error(`Invalid schema name: ${JSON.stringify(schema)}`);
  }
}

/**
 * In-memory {@link ChunksPort}: the behavioral spec of the Pg adapter over an
 * array of rows keyed by (schema, repo, file_path, id). Lets the reindex /
 * context-core jobs be tested without a live `{schema}.chunks` table. The
 * schema-name guard mirrors the Pg adapter so a bad schema is rejected here too.
 */
export class InMemoryChunks implements ChunksPort {
  private seq = 0;

  constructor(
    public rows: ChunkRow[] = [],
    public schemas: Set<string> = new Set(["org_shared"]),
  ) {}

  async schemaExists(schema: string): Promise<boolean> {
    return this.schemas.has(schema);
  }

  async countChunks(schema: string, repo: string): Promise<number> {
    enforceSchema(schema);
    return this.rows.filter((row) => row.schema === schema && row.repo === repo).length;
  }

  async deleteChunksForFile(schema: string, filePath: string, repo: string): Promise<void> {
    enforceSchema(schema);
    this.rows = this.rows.filter(
      (row) => !(row.schema === schema && row.filePath === filePath && row.repo === repo),
    );
  }

  async insertChunk(schema: string, chunk: ChunkInsert): Promise<string | null> {
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

  async setEmbedding(schema: string, chunkId: string, embedding: string): Promise<void> {
    enforceSchema(schema);
    const row = this.rows.find((candidate) => candidate.schema === schema && candidate.id === chunkId);
    if (row) row.embedding = embedding;
  }

  async distinctTeams(): Promise<string[]> {
    const teams = new Set<string>();
    for (const row of this.rows) {
      if (row.schema === "org_shared" && row.team != null) teams.add(row.team);
    }
    return Array.from(teams);
  }

  async countChunksByTeam(team: string): Promise<number> {
    return this.rows.filter((row) => row.schema === "org_shared" && row.team === team).length;
  }

  private orgSharedForRepo(repo: string): ChunkRow[] {
    return this.rows.filter((row) => row.schema === "org_shared" && row.repo === repo);
  }

  async specChunks(repo: string): Promise<SpecChunkRow[]> {
    return this.orgSharedForRepo(repo)
      .filter((row) => row.contentType === "spec")
      .sort((a, b) => a.filePath.localeCompare(b.filePath))
      .map((row) => ({ id: row.id, repo: row.repo, filePath: row.filePath, content: row.content }));
  }

  async codeSymbols(repo: string): Promise<CodeSymbolRow[]> {
    return this.orgSharedForRepo(repo)
      .filter((row) => row.contentType === "code" && typeof row.metadata.symbol_name === "string")
      .map((row) => ({
        symbolName: row.metadata.symbol_name as string,
        symbolType: (row.metadata.symbol_type as string | undefined) ?? null,
        filePath: row.filePath,
      }));
  }

  async hasChunk(repo: string, contentType: string, fileSuffix?: string): Promise<boolean> {
    return this.orgSharedForRepo(repo).some(
      (row) => row.contentType === contentType && (!fileSuffix || row.filePath.endsWith(fileSuffix)),
    );
  }

  async staleChunkCount(repo: string, olderThanDays: number): Promise<number> {
    const cutoff = Date.now() - olderThanDays * 86_400_000;
    return this.orgSharedForRepo(repo).filter((row) => new Date(row.ingestedAt).getTime() < cutoff)
      .length;
  }

  // The double stores a repo's chunks in one schema, so "resolved schema" reads
  // are just repo-scoped reads across whatever schema the fixture used.
  private forRepo(repo: string): ChunkRow[] {
    return this.rows.filter((row) => row.repo === repo);
  }

  async specChunksWithIngest(repo: string): Promise<SpecChunkWithIngest[]> {
    return this.forRepo(repo)
      .filter((row) => row.contentType === "spec")
      .sort((a, b) => a.filePath.localeCompare(b.filePath))
      .map((row) => ({
        repo: row.repo,
        filePath: row.filePath,
        content: row.content,
        ingestedAt: row.ingestedAt,
      }));
  }

  async testChunkRanges(repo: string): Promise<TestChunkRange[]> {
    return this.forRepo(repo)
      .filter((row) => row.contentType === "code")
      .map((row) => ({
        filePath: row.filePath,
        startLine: (row.metadata.start_line as number | undefined) ?? null,
        endLine: (row.metadata.end_line as number | undefined) ?? null,
      }));
  }

  async specChunksForBackfill(repo: string): Promise<SpecChunkWithEmbedding[]> {
    return this.forRepo(repo)
      .filter((row) => row.contentType === "spec")
      .sort((a, b) => a.filePath.localeCompare(b.filePath))
      .map((row) => ({
        repo: row.repo,
        filePath: row.filePath,
        content: row.content,
        ingestedAt: row.ingestedAt,
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
}
