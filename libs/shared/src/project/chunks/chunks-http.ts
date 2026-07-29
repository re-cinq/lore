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
 * ChunksPort over the Lore HTTP API — the station-pod adapter. A pod can't reach
 * Postgres (ADR-031 D7), so it fetches the repo's chunk reads from
 * `GET /api/repos/:o/:r/chunks/:kind` over its scoped token + allowed egress. The
 * server resolves the team schema (else org_shared) exactly as PgChunks does.
 * Read-only: the write surface (insert/delete/embedding) throws — reindex runs
 * Floor-side, never in a station.
 */

const WRITE_ONLY_FLOOR =
  "chunk writes are Floor-only — a station reads chunks over HTTP, never mutates";

export class ChunksHttp implements ChunksPort {
  constructor(
    private readonly baseUrl: string,
    private readonly repo: string,
    private readonly token?: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private headers(): Record<string, string> {
    const h: Record<string, string> = { "content-type": "application/json" };

    if (this.token) {
      h["authorization"] = `Bearer ${this.token}`;
    }

    return h;
  }

  private async get<T>(
    kind: string,
    query: Record<string, string> = {},
  ): Promise<T> {
    const qs = new URLSearchParams(query).toString();
    const url = `${this.baseUrl}/api/repos/${this.repo}/chunks/${kind}${qs ? `?${qs}` : ""}`;
    const res = await this.fetchImpl(url, { headers: this.headers() });

    if (!res.ok) {
      throw new Error(`chunks.${kind} failed: ${res.status}`);
    }

    return (await res.json()) as T;
  }

  async specChunks(_repo: string): Promise<SpecChunkRow[]> {
    return (await this.get<{ specs: SpecChunkRow[] }>("spec")).specs;
  }

  async codeSymbols(_repo: string): Promise<CodeSymbolRow[]> {
    return (await this.get<{ symbols: CodeSymbolRow[] }>("code-symbols"))
      .symbols;
  }

  async specChunksWithIngest(_repo: string): Promise<SpecChunkWithIngest[]> {
    return (await this.get<{ specs: SpecChunkWithIngest[] }>("spec-ingest"))
      .specs;
  }

  async testChunkRanges(_repo: string): Promise<TestChunkRange[]> {
    return (await this.get<{ ranges: TestChunkRange[] }>("test-ranges")).ranges;
  }

  async specChunksForBackfill(
    _repo: string,
  ): Promise<SpecChunkWithEmbedding[]> {
    return (
      await this.get<{ specs: SpecChunkWithEmbedding[] }>("spec-backfill")
    ).specs;
  }

  async codeChunksForBackfill(_repo: string): Promise<CodeChunkFull[]> {
    return (await this.get<{ chunks: CodeChunkFull[] }>("code-backfill"))
      .chunks;
  }

  async hasChunk(
    _repo: string,
    contentType: string,
    fileSuffix?: string,
  ): Promise<boolean> {
    const q: Record<string, string> = { content_type: contentType };

    if (fileSuffix) {
      q.file_suffix = fileSuffix;
    }

    return (await this.get<{ has: boolean }>("has", q)).has;
  }

  async staleChunkCount(_repo: string, olderThanDays: number): Promise<number> {
    return (
      await this.get<{ count: number }>("stale", {
        days: String(olderThanDays),
      })
    ).count;
  }

  // ── Floor-only write surface (unused in a station) ──
  async schemaExists(_schema: string): Promise<boolean> {
    throw new Error(WRITE_ONLY_FLOOR);
  }
  async countChunks(_schema: string, _repo: string): Promise<number> {
    throw new Error(WRITE_ONLY_FLOOR);
  }
  async deleteChunksForFile(
    _schema: string,
    _filePath: string,
    _repo: string,
  ): Promise<void> {
    throw new Error(WRITE_ONLY_FLOOR);
  }
  async insertChunk(
    _schema: string,
    _chunk: ChunkInsert,
  ): Promise<string | null> {
    throw new Error(WRITE_ONLY_FLOOR);
  }
  async setEmbedding(
    _schema: string,
    _chunkId: string,
    _embedding: string,
  ): Promise<void> {
    throw new Error(WRITE_ONLY_FLOOR);
  }
  async distinctTeams(): Promise<string[]> {
    throw new Error(WRITE_ONLY_FLOOR);
  }
  async countChunksByTeam(_team: string): Promise<number> {
    throw new Error(WRITE_ONLY_FLOOR);
  }
  async reindexOwnedFilePaths(
    _schema: string,
    _repo: string,
  ): Promise<string[]> {
    throw new Error(WRITE_ONLY_FLOOR);
  }
  async touchChunksForFiles(
    _schema: string,
    _repo: string,
    _filePaths: string[],
    _minAgeDays: number,
  ): Promise<number> {
    throw new Error(WRITE_ONLY_FLOOR);
  }
  async pruneChunksForFiles(
    _schema: string,
    _repo: string,
    _filePaths: string[],
  ): Promise<number> {
    throw new Error(WRITE_ONLY_FLOOR);
  }
  async relocateLegacyChunks(
    _schema: string,
    _repo: string,
  ): Promise<{ moved: number; dropped: number }> {
    throw new Error(WRITE_ONLY_FLOOR);
  }
}
