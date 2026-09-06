/** Single source of truth for file-scoped TestChunk xid; coverage is file-level. */
export function fileScopedTestChunkXid(repo: string, file: string): string {
  return `${repo}|${file}`;
}
