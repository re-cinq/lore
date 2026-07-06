import type { ChunksPort, SpecChunkRow, CodeSymbolRow } from "./chunks-port.js";

/**
 * project.chunks — the vector-store `chunks` reads a detection run needs, repo
 * bound. Backed by PgChunks on the Floor and ChunksHttp in a station pod (D7:
 * pods read chunks over the API, never Postgres). Only the org_shared per-repo
 * reads the detectors use are exposed here; the reindex write path stays on the
 * raw ChunksPort.
 */
export class ChunkStore {
  constructor(
    private readonly repo: string,
    private readonly chunks: ChunksPort,
  ) {}

  specChunks(): Promise<SpecChunkRow[]> {
    return this.chunks.specChunks(this.repo);
  }

  codeSymbols(): Promise<CodeSymbolRow[]> {
    return this.chunks.codeSymbols(this.repo);
  }

  hasChunk(contentType: string, fileSuffix?: string): Promise<boolean> {
    return this.chunks.hasChunk(this.repo, contentType, fileSuffix);
  }

  staleChunkCount(olderThanDays: number): Promise<number> {
    return this.chunks.staleChunkCount(this.repo, olderThanDays);
  }
}
