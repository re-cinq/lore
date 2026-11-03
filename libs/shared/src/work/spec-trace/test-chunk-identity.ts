import {
  scopedXid,
  type TraceScope,
} from "../../domain/spec-trace/trace-scope.js";
import type { TestDescriptor } from "../../domain/test-report.js";

/** Single source of truth for file-scoped TestChunk xid; coverage is file-level. `scopeKey` is the repo on main and the run-scoped key inside an overlay. */
export function fileScopedTestChunkXid(scopeKey: string, file: string): string {
  return `${scopeKey}|${file}`;
}

/** The xid of one test's own TestChunk, as distinct from its file's. */
export function testChunkXid(scope: TraceScope, testId: string): string {
  return scopedXid(scope, testId);
}

/** The xid of one level of a test's suite chain: the suite names down to `depth`, under the test's file. */
export function suiteLevelXid(
  scope: TraceScope,
  descriptor: Pick<TestDescriptor, "file" | "suite">,
  depth: number,
): string {
  const chain = (descriptor.suite ?? []).slice(0, depth + 1);

  return scopedXid(scope, descriptor.file, chain.join(">"));
}
