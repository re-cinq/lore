/**
 * impact-test-link — couples a changed TEST file to the spec statements it
 * validates.
 *
 * The coverage lookup roots on the file a test *covers*, so a PR that rewrites
 * the test itself produced no finding at all unless that test file happened to
 * appear in its own coverage set — a coverage-config accident, not a contract.
 * This roots on `TestChunk.file_path` directly, which is the edge the graph
 * actually holds: `Statement.validated_by → TestChunk`.
 */

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

/**
 * Statements validated by a test chunk in `file` whose own line span the diff
 * touches. A chunk with no usable span (`end_line` absent — the projector only
 * writes it when the spec link carried one) matches the whole file rather than
 * silently matching nothing: a link with no line information still couples the
 * statement to the file, and dropping it is how `implemented_by` went dark.
 */
export async function testFileImpact(
  dgraph: DgraphClientPort,
  repo: string,
  file: string,
  ranges: [number, number][],
  options: { fileLevel?: boolean } = {},
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
    // `fileLevel` is the honest degrade for a file whose graph coordinates no
    // longer line up with the diff: the link still couples the statement to this
    // file, so report it rather than silently comparing incomparable numbers.
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

    for (const stmt of chunk.stmts ?? []) {
      out.push(toImpactStatement(stmt, file, [test], "test-link"));
    }
  }

  return out;
}
