/**
 * spec-traceability-graph — the single source of truth for a file-scoped
 * TestChunk's xid. Coverage is file-level, so the TestChunk that owns
 * `TestChunk.coverage` (→ Coverage → CodeChunk) is keyed by `(repo, file)`. Both
 * the spec projector (`validated_by` chunks) and the test-report ingest
 * (sentence/anchor `validated_by` targets) must mint THIS exact xid so coverage
 * and validation re-converge on one node — hence one shared function, not three
 * inlined template literals that could drift.
 */
export function fileScopedTestChunkXid(repo: string, file: string): string {
  return `${repo}|${file}`;
}
