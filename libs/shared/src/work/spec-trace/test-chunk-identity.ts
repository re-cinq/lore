/** Single source of truth for file-scoped TestChunk xid; coverage is file-level. `scopeKey` is the repo on main and the run-scoped key inside an overlay. */
export function fileScopedTestChunkXid(scopeKey: string, file: string): string {
  return `${scopeKey}|${file}`;
}
