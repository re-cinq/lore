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

export async function testFileImpact(
  dgraph: DgraphClientPort,
  repo: string,
  file: string,
  { ranges, ...options }: TestFileLookup,
): Promise<Array<ImpactStatement & { xid: string }>> {
  const chunks = await withTxn(dgraph, async (txn) => {
    const res = await txn.queryWithVars(TEST_LINK_QUERY, {
      $repo: repo,
      $fp: file,
    });

    return (res.data?.chunks ?? []) as GraphTestChunk[];
  });
  const out: Array<ImpactStatement & { xid: string }> = [];

  for (const chunk of chunks) {
    const start = chunk["TestChunk.start_line"] ?? 0;
    const end = chunk["TestChunk.end_line"] ?? 0;
    // `fileLevel` degrades for missing coordinates; link couples statement to file.
    const spanKnown = !options.fileLevel && start > 0 && end >= start;

    if (
      spanKnown &&
      !ranges.some(([s, e]) => intervalsOverlap(start, end, s, e))
    ) {
      continue;
    }
    const test = {
      file: chunk["TestChunk.file_path"] ?? file,
      name: chunk["TestChunk.test_name"] ?? "",
      line: start,
    };

    out.push(
      ...(chunk.stmts ?? []).map((stmt) =>
        toImpactStatement(stmt, file, [test], "test-link"),
      ),
    );
  }

  return out;
}
