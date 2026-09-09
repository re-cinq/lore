/** Dgraph reads for the code-side sweep: implementation-chunk coupling, coverage-facet coupling, and orphaned-coverage detection. */

import type { DgraphClientPort } from "../../outbound/spec-trace/deps.js";
import { withTxn } from "../../outbound/spec-trace/dgraph-upsert.js";
import { intervalsOverlap, parseRanges } from "./line-range.js";
import {
  toImpactStatement,
  STATEMENT_PROJECTION,
  type GraphStatement,
  type ImpactStatement,
} from "./impact-statement.js";
import type { OrphanStatement } from "./impact-types.js";

interface GraphImplChunk {
  "CodeChunk.xid"?: string;
  "CodeChunk.start_line"?: number;
  "CodeChunk.end_line"?: number;
  stmts?: GraphStatement[];
}

const IMPL_QUERY = `query q($repo: string, $fp: string) {
  chunks(func: eq(CodeChunk.file_path, $fp)) @filter(eq(CodeChunk.repo, $repo)) {
    CodeChunk.xid
    CodeChunk.start_line
    CodeChunk.end_line
    stmts: ~Statement.implemented_by {
      ${STATEMENT_PROJECTION}
    }
  }
}`;

export interface ImplResult {
  statements: Array<ImpactStatement & { xid: string }>;
  /** Xids of every in-scope CodeChunk, even those with no associated statement (needed for the caller-hop pass). */
  touchedChunkXids: string[];
}

/** CodeChunks in `file` whose line range overlaps any changed range → their statements + xids. */
export async function implementedByImpactAndXids(
  dgraph: DgraphClientPort,
  repo: string,
  file: string,
  ranges: [number, number][],
): Promise<ImplResult> {
  const chunks = await chunksInFile(dgraph, repo, file);
  const inScope = chunks.filter((chunk) => implChunkInScope(chunk, ranges));

  return {
    statements: inScope.flatMap((chunk) =>
      (chunk.stmts ?? []).map((stmt) =>
        toImpactStatement(stmt, file, [], "file-link"),
      ),
    ),
    touchedChunkXids: inScope
      .map((c) => c["CodeChunk.xid"] ?? "")
      .filter(Boolean),
  };
}

/** Every CodeChunk the graph holds for one file. */
async function chunksInFile(
  dgraph: DgraphClientPort,
  repo: string,
  file: string,
): Promise<GraphImplChunk[]> {
  return withTxn(dgraph, async (txn) => {
    const res = await txn.queryWithVars(IMPL_QUERY, { $repo: repo, $fp: file });

    return (res.data.chunks ?? []) as GraphImplChunk[];
  });
}

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
  const { statements } = await implementedByImpactAndXids(
    dgraph,
    repo,
    file,
    ranges,
  );

  return statements;
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

  return covs
    .filter((cov) => coverageOverlaps(cov, ranges))
    .flatMap((cov) => statementsForCoverage(cov, file));
}

/** Whether any range `cov` covers in this file overlaps the diff's changed ranges. */
function coverageOverlaps(
  cov: GraphCoverage,
  ranges: [number, number][],
): boolean {
  const coveredFiles = cov.file ?? [];
  const covered = parseRanges(
    coveredFiles.length === 0 ? "" : (coveredFiles[0]["file|ranges"] ?? ""),
  );

  return covered.some(([cs, ce]) =>
    ranges.some(([s, e]) => intervalsOverlap(cs, ce, s, e)),
  );
}

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

/** A statement is orphaned when EVERY range covering it is killed by the diff's deletions. */
export async function orphanImpact(
  dgraph: DgraphClientPort,
  repo: string,
  file: string,
  deleted: [number, number][],
): Promise<OrphanStatement[]> {
  const covs = await readOrphanCoverages(dgraph, repo, file);
  const byXid = new Map<string, OrphanStatement>();

  for (const stmt of orphanCandidates(covs)) {
    const orphan = orphanFor(stmt, file, deleted);

    if (orphan) {
      byXid.set(orphanKey(stmt, orphan), orphan);
    }
  }

  return [...byXid.values()];
}

/** Coverage nodes touching `file`, read at their orphan-detection projection. */
async function readOrphanCoverages(
  dgraph: DgraphClientPort,
  repo: string,
  file: string,
): Promise<GraphOrphanCoverage[]> {
  return await withTxn(dgraph, async (txn) => {
    const res = await txn.queryWithVars(ORPHAN_QUERY, {
      $repo: repo,
      $fp: file,
    });

    return (res.data.covs ?? []) as GraphOrphanCoverage[];
  });
}

/** Every statement reachable from the coverage nodes that actually cover the file. */
function orphanCandidates(
  covs: GraphOrphanCoverage[],
): GraphFootprintStatement[] {
  return covs
    .filter((cov) => Boolean(cov.file?.length))
    .flatMap((cov) => cov.tc ?? [])
    .flatMap((tc) => tc.stmts ?? []);
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

/** Dedupe key: the statement's own xid, or a spec+text stand-in when the projection omitted it. */
function orphanKey(
  stmt: GraphFootprintStatement,
  orphan: OrphanStatement,
): string {
  return (
    stmt["Statement.xid"] ??
    `${orphan.specPath}::${stmt["Statement.text"] ?? ""}`
  );
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
