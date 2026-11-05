import type { DgraphClientPort } from "./deps.js";
import { withTxn } from "./dgraph-upsert.js";
import { parseRanges } from "../../domain/spec-trace/line-range.js";

/** How a spec statement reaches the asked-about lines: a test declared there validates it, a code chunk there implements it, or a test validating it runs those lines. */
export type StatementReach = "validated" | "implemented" | "covered";

export interface LinkedStatement {
  text: string;
  via: StatementReach;
}

/** One file's lines, 1-based and inclusive. */
export interface LineSpan {
  file: string;
  startLine: number;
  endLine: number;
}

interface StatementText {
  "Statement.text"?: string;
}

interface Chunk {
  start?: number;
  end?: number;
  stmts?: StatementText[];
}

interface CoverageRecord {
  file?: { "file|ranges"?: string }[];
  tc?: { stmts?: StatementText[] }[];
}

interface StatementsAtResult {
  tests?: Chunk[];
  code?: Chunk[];
  covs?: CoverageRecord[];
}

const STATEMENTS_AT_QUERY = `query q($repo: string, $fp: string) {
  tests(func: eq(TestChunk.file_path, $fp)) @filter(eq(TestChunk.repo, $repo)) {
    start: TestChunk.start_line
    end: TestChunk.end_line
    stmts: ~Statement.validated_by { Statement.text }
  }
  code(func: eq(CodeChunk.file_path, $fp)) @filter(eq(CodeChunk.repo, $repo)) {
    start: CodeChunk.start_line
    end: CodeChunk.end_line
    stmts: ~Statement.implemented_by { Statement.text }
  }
  covs(func: eq(Coverage.repo, $repo)) {
    file: Coverage.covers @facets(ranges) @filter(eq(File.path, $fp)) { File.path }
    tc: ~TestChunk.coverage { stmts: ~Statement.validated_by { Statement.text } }
  }
}`;

/** The spec statements that reach `span` on main, each once, in the order validated, implemented, covered. */
export async function statementsAt(
  dgraph: DgraphClientPort,
  repo: string,
  span: LineSpan,
): Promise<LinkedStatement[]> {
  const result = await withTxn(dgraph, async (txn) => {
    const res = await txn.queryWithVars(STATEMENTS_AT_QUERY, {
      $repo: repo,
      $fp: span.file,
    });

    return res.data as StatementsAtResult;
  });

  return statementsReaching(result, span);
}

/** Pure: the statements of the chunks and coverage records that overlap `span`. */
export function statementsReaching(
  result: StatementsAtResult,
  span: LineSpan,
): LinkedStatement[] {
  const found = [
    ...chunkStatements(result.tests, span, "validated"),
    ...chunkStatements(result.code, span, "implemented"),
    ...coveredStatements(result.covs, span),
  ];
  const seen = new Set<string>();

  return found.filter((statement) => {
    if (seen.has(statement.text)) {
      return false;
    }
    seen.add(statement.text);

    return true;
  });
}

function chunkStatements(
  chunks: Chunk[] | undefined,
  span: LineSpan,
  via: StatementReach,
): LinkedStatement[] {
  return (chunks ?? [])
    .filter((chunk) => overlaps(chunk.start, chunk.end ?? chunk.start, span))
    .flatMap((chunk) => toStatements(chunk.stmts, via));
}

function coveredStatements(
  records: CoverageRecord[] | undefined,
  span: LineSpan,
): LinkedStatement[] {
  return (records ?? [])
    .filter((record) =>
      parseRanges(record.file?.[0]?.["file|ranges"] ?? "").some(
        ([start, end]) => overlaps(start, end, span),
      ),
    )
    .flatMap((record) =>
      (record.tc ?? []).flatMap((test) => toStatements(test.stmts, "covered")),
    );
}

function overlaps(
  start: number | undefined,
  end: number | undefined,
  span: LineSpan,
): boolean {
  if (start === undefined || end === undefined) {
    return false;
  }

  return start <= span.endLine && span.startLine <= end;
}

function toStatements(
  stmts: StatementText[] | undefined,
  via: StatementReach,
): LinkedStatement[] {
  return (stmts ?? [])
    .map((stmt) => stmt["Statement.text"])
    .filter((text): text is string => Boolean(text))
    .map((text) => ({ text, via }));
}
