/**
 * trace-impact — the deterministic, zero-LLM impact query for a PR diff.
 *
 * Given a repo's changed file+line ranges, walks the spec-traceability graph to
 * the coupled spec Statements (via CodeChunk overlap → `~Statement.implemented_by`
 * and Coverage-facet overlap → TestChunk → `~Statement.validated_by`), and flags
 * statements whose only coverage the diff deletes (orphans). Pure git/DQL/interval
 * arithmetic — no LLM, so it is reproducible and safe to run on every PR.
 */

import type { DgraphClientPort } from "./deps.js";
import { withTxn } from "./dgraph-upsert.js";

/** One changed file in a diff: `ranges` are the new/modified intervals (for coupling),
 * `deleted` are old-side intervals removed by the diff (for orphan detection). */
export interface ChangedRange {
  path: string;
  ranges: [number, number][];
  deleted?: [number, number][];
}

/** A spec statement coupled to the diff, with the tests that cover it (selectors). */
export interface ImpactStatement {
  specPath: string;
  specTitle: string;
  section?: string;
  statementText: string;
  statementAnchor: string;
  tests: { file: string; name: string; line: number }[];
  changedFile: string;
}

/** A statement whose only coverage the diff deletes. */
export interface OrphanStatement {
  specPath: string;
  specTitle: string;
  statementText: string;
  statementAnchor: string;
  wasCoveredBy: string;
}

export interface ImpactReport {
  status: "ok" | "unavailable";
  statements: ImpactStatement[];
  orphaned: OrphanStatement[];
  testSelectors: string[];
  graphCommit?: string;
  stale?: boolean;
}

/** A GitHub Checks API annotation anchored to a changed line range. */
export interface ImpactAnnotation {
  path: string;
  start_line: number;
  end_line: number;
  annotation_level: "warning" | "notice";
  title: string;
  message: string;
}

const sectionLabel = (section?: string) => (section ? ` ${section}` : "");

/** HTML-comment marker that makes the PR summary comment sticky (updated in place). */
export const IMPACT_COMMENT_MARKER = "<!-- lore-trace-impact -->";

const COMMENT_HEADER = "## 🔍 Lore Spec Impact";

/**
 * Renders the sticky PR summary comment for an ImpactReport. The Action posts
 * this verbatim (find-by-marker, update-in-place) — all formatting lives here so
 * it is unit-tested, not buried in workflow YAML. Advisory tone, no blocking.
 */
export function buildImpactComment(report: ImpactReport): string {
  if (report.status === "unavailable") {
    return `${COMMENT_HEADER}\n\nGraph not available for this repo yet — skipping impact analysis. No action needed.\n\n${IMPACT_COMMENT_MARKER}\n`;
  }

  if (!report.statements.length && !report.orphaned.length) {
    return `${COMMENT_HEADER}\n\nNo spec impact detected for this PR.\n\n${IMPACT_COMMENT_MARKER}\n`;
  }

  const specCount = new Set(report.statements.map((s) => s.specPath)).size;
  const lines = [
    `${COMMENT_HEADER} — advisory`,
    "",
    `This PR touches code coupled to **${report.statements.length} statement(s)** across **${specCount} spec(s)**.`,
  ];

  if (report.statements.length) {
    lines.push(
      "",
      "### Coupled statements",
      "| Spec | Statement | Covering test | Changed file |",
      "|------|-----------|---------------|--------------|",
      ...report.statements.map((s) => {
        const test = s.tests[0];
        const testCell = test ? `${test.file}:${test.line}` : "—";

        return `| ${s.specTitle}${sectionLabel(s.section)} | ${s.statementText} | ${testCell} | ${s.changedFile} |`;
      }),
    );
  }

  if (report.orphaned.length) {
    lines.push(
      "",
      `### ⚠ Coverage warnings (${report.orphaned.length})`,
      ...report.orphaned.map(
        (o) =>
          `- **${o.specTitle}** lost its only coverage — was \`${o.wasCoveredBy}\`, now deleted.`,
      ),
    );
  }

  const commit = report.graphCommit ?? "unknown";
  const staleNote = report.stale ? " · ⚠ baseline may be stale" : "";

  lines.push(
    "",
    `<sub>Deterministic · graph @ \`${commit}\`${staleNote} · no tests run by this check</sub>`,
    "",
    IMPACT_COMMENT_MARKER,
    "",
  );

  return lines.join("\n");
}

/**
 * Renders an ImpactReport into Checks API annotations: a `warning` on the
 * changed range for each coupled statement, a `notice` on the deleted range for
 * each orphaned statement. The diff (`changed`) supplies the line anchors —
 * coupled statements anchor to their file's first changed range, orphans to the
 * deleted range parsed from `wasCoveredBy`.
 */
export function buildImpactAnnotations(
  report: ImpactReport,
  changed: ChangedRange[],
): ImpactAnnotation[] {
  const annotations: ImpactAnnotation[] = [];

  for (const stmt of report.statements) {
    const file = changed.find((c) => c.path === stmt.changedFile);
    const [start, end] = file?.ranges[0] ?? [1, 1];
    const test = stmt.tests[0];
    const coverage = test ? ` Covered by test ${test.file}:${test.line}.` : "";

    annotations.push({
      path: stmt.changedFile,
      start_line: start,
      end_line: end,
      annotation_level: "warning",
      title: `Lore: coupled to ${stmt.specTitle}`,
      message: `⚠ Coupled to Spec "${stmt.specTitle}"${sectionLabel(stmt.section)} — "${stmt.statementText}".${coverage} Verify this still holds. → ${stmt.statementAnchor}`,
    });
  }

  for (const orphan of report.orphaned) {
    const [, range] = orphan.wasCoveredBy.split(":");
    const [start, end] = parseRanges(range ?? "")[0] ?? [1, 1];
    const path = orphan.wasCoveredBy.split(":")[0];

    annotations.push({
      path,
      start_line: start,
      end_line: end,
      annotation_level: "notice",
      title: `Lore: coverage removed for ${orphan.specTitle}`,
      message: `ℹ Removes the only coverage for Spec "${orphan.specTitle}" — "${orphan.statementText}". No test now exercises it.`,
    });
  }

  return annotations;
}

/** Two closed integer intervals overlap iff neither ends before the other begins. */
function intervalsOverlap(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
): boolean {
  return aStart <= bEnd && bStart <= aEnd;
}

interface GraphSpecRef {
  "Spec.file_path"?: string;
  "Spec.title"?: string;
}
interface GraphStatement {
  "Statement.xid"?: string;
  "Statement.text"?: string;
  // Statement.spec / Statement.section are single-cardinality `uid` edges, so
  // Dgraph returns them as objects, not arrays.
  spec?: GraphSpecRef;
  section?: { "Section.heading"?: string };
}
interface GraphImplChunk {
  "CodeChunk.start_line"?: number;
  "CodeChunk.end_line"?: number;
  stmts?: GraphStatement[];
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

/** Builds an ImpactStatement from a graph Statement, carrying its xid for dedup. */
function toImpactStatement(
  stmt: GraphStatement,
  changedFile: string,
  tests: ImpactStatement["tests"],
): ImpactStatement & { xid: string } {
  const specPath = stmt.spec?.["Spec.file_path"] ?? "";

  return {
    xid:
      stmt["Statement.xid"] ?? `${specPath}::${stmt["Statement.text"] ?? ""}`,
    specPath,
    specTitle: stmt.spec?.["Spec.title"] ?? "",
    section: stmt.section?.["Section.heading"],
    statementText: stmt["Statement.text"] ?? "",
    statementAnchor: specPath,
    tests,
    changedFile,
  };
}

const IMPL_QUERY = `query q($repo: string, $fp: string) {
  chunks(func: eq(CodeChunk.file_path, $fp)) @filter(eq(CodeChunk.repo, $repo)) {
    CodeChunk.start_line
    CodeChunk.end_line
    stmts: ~Statement.implemented_by {
      Statement.xid
      Statement.text
      spec: Statement.spec { Spec.file_path Spec.title }
      section: Statement.section { Section.heading }
    }
  }
}`;

/** CodeChunks in `file` whose line range overlaps any changed range → their statements. */
async function implementedByImpact(
  dgraph: DgraphClientPort,
  repo: string,
  file: string,
  ranges: [number, number][],
): Promise<Array<ImpactStatement & { xid: string }>> {
  const chunks = await withTxn(dgraph, async (txn) => {
    const res = await txn.queryWithVars(IMPL_QUERY, { $repo: repo, $fp: file });

    return (res.data?.chunks ?? []) as GraphImplChunk[];
  });
  const out: Array<ImpactStatement & { xid: string }> = [];

  for (const chunk of chunks) {
    const start = chunk["CodeChunk.start_line"] ?? 0;
    const end = chunk["CodeChunk.end_line"] ?? 0;

    if (!ranges.some(([s, e]) => intervalsOverlap(start, end, s, e))) {
      continue;
    }

    for (const stmt of chunk.stmts ?? []) {
      out.push(toImpactStatement(stmt, file, []));
    }
  }

  return out;
}

// No @cascade: it would propagate to the nested stmts block and drop statements
// that lack an optional Section. Instead non-covering Coverage nodes are skipped
// in code (their filtered `file` block comes back empty → no facet → no overlap).
const COVERAGE_QUERY = `query q($repo: string, $fp: string) {
  covs(func: eq(Coverage.repo, $repo)) {
    file: Coverage.covers @facets(ranges) @filter(eq(File.path, $fp)) { File.path }
    tc: ~TestChunk.coverage {
      TestChunk.file_path
      TestChunk.test_name
      TestChunk.start_line
      stmts: ~Statement.validated_by {
        Statement.xid
        Statement.text
        spec: Statement.spec { Spec.file_path Spec.title }
        section: Statement.section { Section.heading }
      }
    }
  }
}`;

/** Coverage covering `file` whose facet ranges overlap the diff → validated statements + selectors. */
async function validatedByImpact(
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

    return (res.data?.covs ?? []) as GraphCoverage[];
  });
  const out: Array<ImpactStatement & { xid: string }> = [];

  for (const cov of covs) {
    const covered = parseRanges(cov.file?.[0]?.["file|ranges"] ?? "");

    if (
      !covered.some(([cs, ce]) =>
        ranges.some(([s, e]) => intervalsOverlap(cs, ce, s, e)),
      )
    ) {
      continue;
    }

    for (const tc of cov.tc ?? []) {
      const test = {
        file: tc["TestChunk.file_path"] ?? "",
        name: tc["TestChunk.test_name"] ?? "",
        line: tc["TestChunk.start_line"] ?? 0,
      };

      for (const stmt of tc.stmts ?? []) {
        out.push(toImpactStatement(stmt, file, [test]));
      }
    }
  }

  return out;
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

/** A statement is orphaned when EVERY range that covers it is killed by the diff's
 * deletions — i.e. lives in `file` and overlaps a deleted interval. */
async function orphanImpact(
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

    return (res.data?.covs ?? []) as GraphOrphanCoverage[];
  });
  const byXid = new Map<string, OrphanStatement>();

  for (const cov of covs) {
    if (!cov.file?.length) {
      continue;
    }

    for (const tc of cov.tc ?? []) {
      for (const stmt of tc.stmts ?? []) {
        const intervals = (stmt.footprint ?? []).flatMap((ft) =>
          (ft.cov?.covers ?? []).flatMap((f) =>
            parseRanges(f["covers|ranges"] ?? "").map(([s, e]) => ({
              file: f["File.path"] ?? "",
              start: s,
              end: e,
            })),
          ),
        );
        const isKilled = (iv: { file: string; start: number; end: number }) =>
          iv.file === file &&
          deleted.some(([ds, de]) =>
            intervalsOverlap(iv.start, iv.end, ds, de),
          );

        if (!intervals.length || !intervals.every(isKilled)) {
          continue;
        }
        const killed = intervals.find(isKilled)!;
        const specPath = stmt.spec?.["Spec.file_path"] ?? "";
        const xid =
          stmt["Statement.xid"] ??
          `${specPath}::${stmt["Statement.text"] ?? ""}`;

        byXid.set(xid, {
          specPath,
          specTitle: stmt.spec?.["Spec.title"] ?? "",
          statementText: stmt["Statement.text"] ?? "",
          statementAnchor: specPath,
          wasCoveredBy: `${killed.file}:${killed.start}-${killed.end}`,
        });
      }
    }
  }

  return [...byXid.values()];
}

/** Unions statements from every coupling path by xid, merging their test selectors. */
function mergeStatements(
  raw: Array<ImpactStatement & { xid: string }>,
): ImpactStatement[] {
  const byXid = new Map<string, ImpactStatement & { xid: string }>();

  for (const stmt of raw) {
    const existing = byXid.get(stmt.xid);

    if (!existing) {
      byXid.set(stmt.xid, { ...stmt, tests: [...stmt.tests] });
      continue;
    }

    for (const test of stmt.tests) {
      if (
        !existing.tests.some(
          (t) => t.file === test.file && t.name === test.name,
        )
      ) {
        existing.tests.push(test);
      }
    }
  }

  return [...byXid.values()].map(({ xid: _xid, ...rest }) => rest);
}

export async function computeImpact(
  dgraph: DgraphClientPort | null,
  repo: string,
  changed: ChangedRange[],
): Promise<ImpactReport> {
  if (!dgraph) {
    return {
      status: "unavailable",
      statements: [],
      orphaned: [],
      testSelectors: [],
    };
  }
  const raw: Array<ImpactStatement & { xid: string }> = [];
  const orphaned: OrphanStatement[] = [];

  for (const { path, ranges, deleted } of changed) {
    raw.push(...(await implementedByImpact(dgraph, repo, path, ranges)));
    raw.push(...(await validatedByImpact(dgraph, repo, path, ranges)));

    if (deleted?.length) {
      orphaned.push(...(await orphanImpact(dgraph, repo, path, deleted)));
    }
  }
  const statements = mergeStatements(raw);
  const testSelectors = [
    ...new Set(statements.flatMap((s) => s.tests.map((t) => t.file))),
  ];

  return { status: "ok", statements, orphaned, testSelectors };
}

/** Inverse of ingest-coverage's `serializeRanges`: "5-10,20-25" → [[5,10],[20,25]]. */
export function parseRanges(facet: string): [number, number][] {
  const ranges: [number, number][] = [];

  for (const part of facet.split(",")) {
    const [rawStart, rawEnd, ...rest] = part.split("-");

    if (rest.length || !rawStart || !rawEnd) {
      continue;
    }
    const start = Number(rawStart);
    const end = Number(rawEnd);

    if (Number.isFinite(start) && Number.isFinite(end)) {
      ranges.push([start, end]);
    }
  }

  return ranges;
}
