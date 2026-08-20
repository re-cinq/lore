import { enforceTrue } from "../../lib/enforce.js";
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
 * One stored chunk row in {@link InMemoryChunks}.
 *
 * NOT the `Chunk` model, deliberately. It carries `schema` — which team schema
 * the row lives in, a thing the double must track because it has no schemas —
 * and the formatted `embedding` string set after insert, which the model omits
 * because a 768-float vector is not something a reader of a chunk wants. It also
 * drops `author`, which nothing in the double's behaviour turns on.
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
  enforceTrue(
    SCHEMA_RE.test(schema),
    Error,
    `Invalid schema name: ${JSON.stringify(schema)}`,
  );
}

function chunkIndexOf(row: ChunkRow): number | null {
  return (row.metadata.chunk_index as number | undefined) ?? null;
}

/** Mirrors the Pg adapter's spec-read ordering: `file_path, chunk_index NULLS
 * LAST, ingested_at`. */
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

  async staleChunkCount(repo: string, olderThanDays: number): Promise<number> {
    const cutoff = Date.now() - olderThanDays * 86_400_000;

    return this.forRepo(repo).filter(
      (row) =>
        row.metadata.ingested_by === "reindex-job" &&
        new Date(row.ingestedAt).getTime() < cutoff,
    ).length;
  }

  // The double stores a repo's chunks in one schema, so "resolved schema" reads
  // are just repo-scoped reads across whatever schema the fixture used.
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
        ingestedAt: row.ingestedAt ?? null,
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

  private reindexOwnedForRepo(schema: string, repo: string): ChunkRow[] {
    return this.rows.filter(
      (row) =>
        row.schema === schema &&
        row.repo === repo &&
        row.metadata.ingested_by === "reindex-job",
    );
  }

  async reindexOwnedFilePaths(schema: string, repo: string): Promise<string[]> {
    enforceSchema(schema);

    return Array.from(
      new Set(
        this.reindexOwnedForRepo(schema, repo).map((row) => row.filePath),
      ),
    );
  }

  async chunkedFilePaths(schema: string, repo: string): Promise<string[]> {
    enforceSchema(schema);

    return Array.from(
      new Set(
        this.rows
          .filter((row) => row.schema === schema && row.repo === repo)
          .map((row) => row.filePath),
      ),
    );
  }

  async staleChunkerFiles(
    schema: string,
    repo: string,
    version: number,
    limit: number,
  ): Promise<string[]> {
    enforceSchema(schema);
    const stale = this.rows.filter(
      (row) =>
        row.schema === schema &&
        row.repo === repo &&
        row.contentType === "code" &&
        ((row.metadata.chunker_version as number | undefined) ?? 0) < version,
    );

    return Array.from(new Set(stale.map((row) => row.filePath)))
      .sort()
      .slice(0, limit);
  }

  async touchChunksForFiles(
    schema: string,
    repo: string,
    filePaths: string[],
    minAgeDays: number,
  ): Promise<number> {
    enforceSchema(schema);
    const paths = new Set(filePaths);
    const cutoff = Date.now() - minAgeDays * 86_400_000;
    const named = this.reindexOwnedForRepo(schema, repo).filter((row) =>
      paths.has(row.filePath),
    );
    const oldestByFile = new Map<string, number>();

    for (const row of named) {
      const stamp = new Date(row.ingestedAt).getTime();
      const oldest = oldestByFile.get(row.filePath);

      oldestByFile.set(row.filePath, Math.min(stamp, oldest ?? stamp));
    }

    const targets = named.filter(
      (row) => (oldestByFile.get(row.filePath) ?? Infinity) < cutoff,
    );
    const now = new Date().toISOString();

    for (const row of targets) {
      row.ingestedAt = now;
    }

    return targets.length;
  }

  async pruneChunksForFiles(
    schema: string,
    repo: string,
    filePaths: string[],
  ): Promise<number> {
    enforceSchema(schema);
    const paths = new Set(filePaths);
    const before = this.rows.length;

    this.rows = this.rows.filter(
      (row) =>
        !(
          row.schema === schema &&
          row.repo === repo &&
          row.metadata.ingested_by === "reindex-job" &&
          paths.has(row.filePath)
        ),
    );

    return before - this.rows.length;
  }

  async relocateLegacyChunks(
    schema: string,
    repo: string,
  ): Promise<{ moved: number; dropped: number }> {
    enforceSchema(schema);
    enforceTrue(
      schema !== "org_shared",
      Error,
      "relocateLegacyChunks target must not be org_shared",
    );
    // Snapshot the target BEFORE moving anything — the Pg statement's dedupe
    // probes all see the pre-statement target state, so a multi-chunk file
    // moves wholesale rather than deduping against its own first chunk.
    const target = this.rows.filter(
      (row) => row.schema === schema && row.repo === repo,
    );
    const targetFiles = new Set(target.map((row) => row.filePath));
    const targetIds = new Set(target.map((row) => row.id));
    const legacy = this.rows.filter(
      (row) => row.schema === "org_shared" && row.repo === repo,
    );
    const dropIds = new Set<string>();
    let moved = 0;

    for (const row of legacy) {
      if (targetFiles.has(row.filePath) || targetIds.has(row.id)) {
        dropIds.add(row.id);
        continue;
      }
      const adopt =
        row.metadata.ingested_by == null &&
        ["doc", "code", "adr", "spec"].includes(row.contentType);

      row.schema = schema;
      row.team = schema;
      row.metadata = {
        ...row.metadata,
        migrated_from: "org_shared",
        ...(adopt ? { ingested_by: "reindex-job" } : {}),
      };
      moved++;
    }

    this.rows = this.rows.filter(
      (row) =>
        !(
          row.schema === "org_shared" &&
          row.repo === repo &&
          dropIds.has(row.id)
        ),
    );

    return { moved, dropped: moved + dropIds.size };
  }
}
