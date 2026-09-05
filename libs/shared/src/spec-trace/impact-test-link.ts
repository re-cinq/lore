/** Couples changed TEST file to spec statements it validates; roots on TestChunk.file_path edge. */

import type { DgraphClientPort } from "./deps.js";
import { withTxn } from "./dgraph-upsert.js";
import {
  toImpactStatement,
  STATEMENT_PROJECTION,
  type GraphStatement,
  type ImpactStatement,
} from "./impact-statement.js";
import { intervalsOverlap } from "./line-range.js";

const TEST_LINK_QUERY = `query q($repo: string, $fp: string) {
  chunks(func: eq(TestChunk.file_path, $fp)) @filter(eq(TestChunk.repo, $repo)) {
    TestChunk.file_path
    TestChunk.test_name
    TestChunk.start_line
    TestChunk.end_line
    stmts: ~Statement.validated_by {
      ${STATEMENT_PROJECTION}
    }
  }
}`;

interface GraphTestChunk {
  "TestChunk.file_path"?: string;
  "TestChunk.test_name"?: string;
  "TestChunk.start_line"?: number;
  "TestChunk.end_line"?: number;
  stmts?: GraphStatement[];
}

/** Statements validated by a test chunk in file whose span the diff touches; missing span matches whole file. */
export interface TestFileLookup {
  ranges: [number, number][];
  fileLevel?: boolean;
}

/** Whether `chunk`'s span overlaps `ranges` (or the span is unknown/degraded to file-level, in which case it always matches). */
function testChunkInScope(
  chunk: GraphTestChunk,
  ranges: [number, number][],
  fileLevel: boolean | undefined,
): boolean {
  const start = chunk["TestChunk.start_line"] ?? 0;
  const end = chunk["TestChunk.end_line"] ?? 0;
  // `fileLevel` degrades for missing coordinates; link couples statement to file.
  const spanKnown = !fileLevel && start > 0 && end >= start;

  return (
    !spanKnown || ranges.some(([s, e]) => intervalsOverlap(start, end, s, e))
  );
}

function statementsForTestChunk(
  chunk: GraphTestChunk,
  file: string,
): Array<ImpactStatement & { xid: string }> {
  const test = {
    file: chunk["TestChunk.file_path"] ?? file,
    name: chunk["TestChunk.test_name"] ?? "",
    line: chunk["TestChunk.start_line"] ?? 0,
  };

  return (chunk.stmts ?? []).map((stmt) =>
    toImpactStatement(stmt, file, [test], "test-link"),
  );
}

export async function testFileImpact(
  dgraph: DgraphClientPort,
  repo: string,
  file: string,
  { ranges, fileLevel }: TestFileLookup,
): Promise<Array<ImpactStatement & { xid: string }>> {
  const chunks = await withTxn(dgraph, async (txn) => {
    const res = await txn.queryWithVars(TEST_LINK_QUERY, {
      $repo: repo,
      $fp: file,
    });

    return (res.data.chunks ?? []) as GraphTestChunk[];
  });

  return chunks
    .filter((chunk) => testChunkInScope(chunk, ranges, fileLevel))
    .flatMap((chunk) => statementsForTestChunk(chunk, file));
}
