export const CONTEXT_PAGE_SIZE = 50;

export interface ContextChunkPage {
  chunks: Record<string, unknown>[];
  hasMore: boolean;
}
