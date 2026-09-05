/** Dgraph reads for the code-side sweep: implementation-chunk coupling, coverage-facet coupling, and orphaned-coverage detection. */

import type { DgraphClientPort } from "./deps.js";
import { withTxn } from "./dgraph-upsert.js";
import { intervalsOverlap, parseRanges } from "./line-range.js";
import {
  toImpactStatement,
  STATEMENT_PROJECTION,
  type GraphStatement,
  type ImpactStatement,
} from "./impact-statement.js";
import type { OrphanStatement } from "./impact-types.js";

interface GraphImplChunk {
  "CodeChunk.start_line"?: number;
  "CodeChunk.end_line"?: number;
  stmts?: GraphStatement[];
}

const IMPL_QUERY = `query q($repo: string, $fp: string) {
  chunks(func: eq(CodeChunk.file_path, $fp)) @filter(eq(CodeChunk.repo, $repo)) {
    CodeChunk.start_line
    CodeChunk.end_line
    stmts: ~Statement.implemented_by {
      ${STATEMENT_PROJECTION}
    }
  }
}`;

/** Whether `chunk`'s span overlaps `ranges` — an unbounded chunk (no `end_line` producer, only `#L12` anchors are written) couples the whole file rather than matching nothing. */
function implChunkInScope(
  chunk: GraphImplChunk,
  ranges: [number, number][],
): boolean {
  const start = chunk["CodeChunk.start_line"] ?? 0;
  const end = chunk["CodeChunk.end_line"] ?? 0;
  const spanKnown = start > 0 && end >= start;

  return (
    !spanKnown || ranges.some(([s, e]) => intervalsOverlap(start, end, s, e))
  );
}

/** CodeChunks in `file` whose line range overlaps any changed range → their statements. */
export async function implementedByImpact(
  dgraph: DgraphClientPort,
  repo: string,
  file: string,
  ranges: [number, number][],
): Promise<Array<ImpactStatement & { xid: string }>> {
  const chunks = await withTxn(dgraph, async (txn) => {
    const res = await txn.queryWithVars(IMPL_QUERY, { $repo: repo, $fp: file });

    return (res.data.chunks ?? []) as GraphImplChunk[];
  });

  return chunks
    .filter((chunk) => implChunkInScope(chunk, ranges))
    .flatMap((chunk) =>
      (chunk.stmts ?? []).map((stmt) =>
        toImpactStatement(stmt, file, [], "file-link"),
      ),
    );
}

interface GraphTestChunk {
  "TestChunk.file_path"?: string;
  "TestChunk.test_name"?: string;
  "TestChunk.start_line"?: number;
  stmts?: GraphStatement[];
}
interface GraphCoverage {
  file?: { "file|ranges"?: string }[];
  tc?: GraphTestChunk[];
}

// No @cascade: it would drop statements lacking an optional Section; non-covering Coverage nodes are skipped in code instead.
const COVERAGE_QUERY = `query q($repo: string, $fp: string) {
  covs(func: eq(Coverage.repo, $repo)) {
    file: Coverage.covers @facets(ranges) @filter(eq(File.path, $fp)) { File.path }
    tc: ~TestChunk.coverage {
      TestChunk.file_path
      TestChunk.test_name
      TestChunk.start_line
      stmts: ~Statement.validated_by {
        ${STATEMENT_PROJECTION}
      }
    }
  }
}`;

/** Every statement validated by `cov`'s test chunks, tagged with that chunk's test selector. */
function statementsForCoverage(
  cov: GraphCoverage,
  file: string,
): Array<ImpactStatement & { xid: string }> {
  return (cov.tc ?? []).flatMap((tc) => {
    const test = {
      file: tc["TestChunk.file_path"] ?? "",
      name: tc["TestChunk.test_name"] ?? "",
      line: tc["TestChunk.start_line"] ?? 0,
    };

    return (tc.stmts ?? []).map((stmt) =>
      toImpactStatement(stmt, file, [test], "coverage"),
    );
  });
}

/** Coverage covering `file` whose facet ranges overlap the diff → validated statements + selectors. */
export async function validatedByImpact(
  dgraph: DgraphClientPort,
  repo: string,
  file: string,
  ranges: [number, number][],
): Promise<Array<ImpactStatement & { xid: string }>> {
  const covs = await withTxn(dgraph, async (txn) => {
    const res = await txn.queryWithVars(COVERAGE_QUERY, {
      $repo: repo,
      $fp: file,
    });

    return (res.data.covs ?? []) as GraphCoverage[];
  });

  const overlapping = covs.filter((cov) => {
    const covered = parseRanges(cov.file?.[0]?.["file|ranges"] ?? "");

    return covered.some(([cs, ce]) =>
      ranges.some(([s, e]) => intervalsOverlap(cs, ce, s, e)),
    );
  });

  return overlapping.flatMap((cov) => statementsForCoverage(cov, file));
}

interface GraphFootprintStatement extends GraphStatement {
  footprint?: {
    cov?: { covers?: { "File.path"?: string; "covers|ranges"?: string }[] };
  }[];
}
interface GraphOrphanCoverage {
  file?: { "File.path"?: string }[];
  tc?: { stmts?: GraphFootprintStatement[] }[];
}

const ORPHAN_QUERY = `query q($repo: string, $fp: string) {
  covs(func: eq(Coverage.repo, $repo)) {
    file: Coverage.covers @filter(eq(File.path, $fp)) { File.path }
    tc: ~TestChunk.coverage {
      stmts: ~Statement.validated_by {
        Statement.xid
        Statement.text
        spec: Statement.spec { Spec.file_path Spec.title }
        footprint: Statement.validated_by {
          cov: TestChunk.coverage {
            covers: Coverage.covers @facets(ranges) { File.path }
          }
        }
      }
    }
  }
}`;

interface FootprintInterval {
  file: string;
  start: number;
  end: number;
}

/** Every line range this statement's coverage footprint touches. */
function footprintIntervals(
  stmt: GraphFootprintStatement,
): FootprintInterval[] {
  return (stmt.footprint ?? []).flatMap((ft) =>
    (ft.cov?.covers ?? []).flatMap((f) =>
      parseRanges(f["covers|ranges"] ?? "").map(([s, e]) => ({
        file: f["File.path"] ?? "",
        start: s,
        end: e,
      })),
    ),
  );
}

function isFootprintKilled(
  iv: FootprintInterval,
  file: string,
  deleted: [number, number][],
): boolean {
  return (
    iv.file === file &&
    deleted.some(([ds, de]) => intervalsOverlap(iv.start, iv.end, ds, de))
  );
}

function buildOrphanStatement(
  stmt: GraphFootprintStatement,
  killed: FootprintInterval,
): OrphanStatement {
  const specPath = stmt.spec?.["Spec.file_path"] ?? "";

  return {
    specPath,
    specTitle: stmt.spec?.["Spec.title"] ?? "",
    statementText: stmt["Statement.text"] ?? "",
    statementAnchor: specPath,
    wasCoveredBy: `${killed.file}:${killed.start}-${killed.end}`,
  };
}

/** The orphan record for a statement whose whole footprint the diff's deletions kill, or undefined when it survives. */
function orphanFor(
  stmt: GraphFootprintStatement,
  file: string,
  deleted: [number, number][],
): OrphanStatement | undefined {
  const intervals = footprintIntervals(stmt);
  const killed = intervals.filter((iv) => isFootprintKilled(iv, file, deleted));

  if (intervals.length === 0 || killed.length !== intervals.length) {
    return undefined;
  }

  return buildOrphanStatement(stmt, killed[0]);
}

/** A statement is orphaned when EVERY range covering it is killed by the diff's deletions. */
export async function orphanImpact(
  dgraph: DgraphClientPort,
  repo: string,
  file: string,
  deleted: [number, number][],
): Promise<OrphanStatement[]> {
  const covs = await withTxn(dgraph, async (txn) => {
    const res = await txn.queryWithVars(ORPHAN_QUERY, {
      $repo: repo,
      $fp: file,
    });

    return (res.data.covs ?? []) as GraphOrphanCoverage[];
  });
  const byXid = new Map<string, OrphanStatement>();

  const candidateStmts = covs
    .filter((cov) => Boolean(cov.file?.length))
    .flatMap((cov) => cov.tc ?? [])
    .flatMap((tc) => tc.stmts ?? []);

  for (const stmt of candidateStmts) {
    const orphan = orphanFor(stmt, file, deleted);

    if (!orphan) {
      continue;
    }
    const xid =
      stmt["Statement.xid"] ??
      `${orphan.specPath}::${stmt["Statement.text"] ?? ""}`;

    byXid.set(xid, orphan);
  }

  return [...byXid.values()];
}
