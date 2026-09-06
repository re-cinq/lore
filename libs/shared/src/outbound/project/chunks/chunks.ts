import type {
  ChunksPort,
  SpecChunkRow,
  CodeSymbolRow,
  SpecChunkWithIngest,
  TestChunkRange,
  SpecChunkWithEmbedding,
  CodeChunkFull,
} from "./chunks-port.js";

/** project.chunks: the vector-store `chunks` reads a detection run needs, repo bound. */
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

  specChunksWithIngest(): Promise<SpecChunkWithIngest[]> {
    return this.chunks.specChunksWithIngest(this.repo);
  }

  testChunkRanges(): Promise<TestChunkRange[]> {
    return this.chunks.testChunkRanges(this.repo);
  }

  specChunksForBackfill(): Promise<SpecChunkWithEmbedding[]> {
    return this.chunks.specChunksForBackfill(this.repo);
  }

  codeChunksForBackfill(): Promise<CodeChunkFull[]> {
    return this.chunks.codeChunksForBackfill(this.repo);
  }
}
