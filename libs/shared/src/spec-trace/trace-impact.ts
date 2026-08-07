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
import { intervalsOverlap, parseRanges } from "./line-range.js";
import {
  toImpactStatement,
  mergeStatements,
  STATEMENT_PROJECTION,
  type GraphStatement,
  type ImpactStatement,
} from "./impact-statement.js";
import { testFileImpact } from "./impact-test-link.js";
import { summarizeStatement } from "./impact-render.js";
import { readGraphBaseline } from "./graph-baseline.js";
import { specFileImpact } from "./impact-statement-delta.js";

export { parseRanges } from "./line-range.js";
export type {
  ImpactStatement,
  Evidence,
  ChangeKind,
} from "./impact-statement.js";

/** One changed file in a diff: `ranges` are the new/modified intervals (for coupling),
 * `deleted` are old-side intervals removed by the diff (for orphan detection). */
export interface ChangedRange {
  path: string;
  ranges: [number, number][];
  deleted?: [number, number][];
  /**
   * Old-side intervals of EVERY hunk, in the diff base's line numbering. This is
   * the coordinate system the graph's ranges live in; `ranges` is head-side and
   * exists only to anchor annotations. Absent from protocol-1 clients.
   */
  baseRanges?: [number, number][];
  /**
   * True when this file is byte-identical at the graph's baseline commit and at
   * the diff base — which makes `baseRanges` exactly graph coordinates. False
   * means the file genuinely moved since the graph last saw it, and no
   * arithmetic can honestly line the two up.
   */
  aligned?: boolean;
}

/** Why a file or a whole run contributed no line-precise finding. */
export type SkipReason = "unaligned" | "no-baseline" | "legacy-client";

/** A statement whose only coverage the diff deletes. */
export interface OrphanStatement {
  specPath: string;
  specTitle: string;
  statementText: string;
  statementAnchor: string;
  wasCoveredBy: string;
}

/**
 * The head content of a changed spec/ADR. Sent by the client because it already
 * has the checkout — no GitHub round-trip, and it works on fork PRs.
 */
export interface ChangedDoc {
  path: string;
  content: string;
}

export interface ImpactOptions {
  /** Head content of changed spec/ADR files, for the statement-identity diff. */
  docs?: ChangedDoc[];
  /**
   * Wire-format the client speaks. 1 (or absent) means it computed its diff
   * against the base-branch tip rather than the merge base, so its file list
   * includes everything merged to the base since the branch point — findings
   * from it are not trustworthy and are suppressed rather than published.
   */
  protocol?: number;
}

export interface ImpactReport {
  status: "ok" | "unavailable";
  /** Client wire-format, echoed so the comment can explain a suppressed run. */
  protocol?: number;
  /** Whether line-precise lookups could be trusted for every examined file. */
  coordinates?: "aligned" | "unverified";
  skipped?: { path: string; reason: SkipReason }[];
  statements: ImpactStatement[];
  orphaned: OrphanStatement[];
  testSelectors: string[];
  /** Commit the graph's line ranges are expressed in; absent when never stamped. */
  graphCommit?: string;
  /** ISO-8601 timestamp of that stamp. */
  graphCommitAt?: string;
  /**
   * What the check actually looked at. A bare "no impact" over files the graph
   * has no data for is what taught people to ignore this check; these numbers
   * let the comment say so instead of implying a clean bill of health.
   */
  examined?: {
    files: number;
    withGraphData: number;
    docs: number;
    /** Statements present in a changed spec that the graph has never seen. */
    newStatements: number;
    /** Statements the diff changed that no test validated — counted, not listed. */
    changedWithoutTests: number;
  };
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

/** Rows shown before the rest is folded away — a wall of them reads as noise. */
const MAX_ROWS = 10;

/**
 * The honest negative. A bare "No spec impact detected" over files the graph has
 * no data for reads as a clean bill of health and is what taught people to skim
 * past this check; say what was actually examined instead.
 */
function describeExamined(report: ImpactReport): string {
  const seen = report.examined;

  if (!seen) {
    return "No spec impact detected for this PR.";
  }
  // Docs are examined at statement level, so they are neither "had graph data"
  // (the line-based lookups usually find nothing in a .md) nor blind. Counting
  // them as blind told the reader the check could not speak for exactly the
  // files it read most closely. Clamped: a doc could also carry line data.
  const blind = Math.max(0, seen.files - seen.withGraphData - seen.docs);
  const parts = [
    `Examined **${seen.files} changed file(s)**: ${seen.withGraphData} had graph data (no coupling found), ${blind} had none — no ingested test run covers them, so this check cannot speak for them.`,
  ];

  const notes = docNotes(seen);

  if (seen.docs) {
    // Only claim nothing moved when nothing did. The counted-not-listed
    // populations are the common case for a spec PR, and asserting "no
    // projected statement changed" beside "114 changed statement(s)" is exactly
    // the kind of contradiction that teaches people to stop reading.
    parts.push(
      notes.length
        ? `Also read **${seen.docs} changed spec/ADR** at statement level.`
        : `Also read **${seen.docs} changed spec/ADR** at statement level; no projected statement changed.`,
    );
  }

  parts.push(...notes);

  return parts.join(" ");
}

/**
 * The doc-side populations that are counted rather than listed. Reported even
 * when nothing else is, so a bounded output never reads as an empty one.
 */
function docNotes(seen: NonNullable<ImpactReport["examined"]>): string[] {
  const notes: string[] = [];

  if (seen.changedWithoutTests) {
    notes.push(
      `**${seen.changedWithoutTests} changed statement(s)** had no validating test, so no coverage broke.`,
    );
  }

  if (seen.newStatements) {
    notes.push(
      `**${seen.newStatements} new statement(s)** have no test link yet.`,
    );
  }

  return notes;
}

/**
 * The provenance line. `graph @ unknown` was printed on every comment ever
 * posted, because nothing set the field — an admission of ignorance dressed up
 * as a reading. Say which commit the graph's ranges belong to, or say plainly
 * that the repo has never been stamped.
 */
function describeBaseline(report: ImpactReport): string {
  const unaligned = (report.skipped ?? []).filter(
    (s) => s.reason === "unaligned",
  ).length;
  const skipNote = unaligned
    ? ` · ${unaligned} file(s) skipped: changed since the graph last saw them, so their line numbers no longer line up`
    : "";

  if (!report.graphCommit) {
    return "graph baseline unknown (no ingested test run has stamped this repo) — line-precise coupling skipped";
  }
  const at = report.graphCommitAt
    ? ` (projected ${report.graphCommitAt.slice(0, 10)})`
    : "";

  return `graph @ \`${report.graphCommit.slice(0, 7)}\`${at}${skipNote}`;
}

const testCellFor = (s: ImpactStatement) =>
  s.tests[0] ? `${s.tests[0].file}:${s.tests[0].line}` : "—";

/**
 * Collapses findings that would render as identical rows. #1077 showed the same
 * test/file pair four times; a reader cannot tell repetition from emphasis, and
 * the headline count has to agree with what the table shows.
 */
function dedupeRows(statements: ImpactStatement[]): ImpactStatement[] {
  const seen = new Set<string>();

  return statements.filter((s) => {
    // JSON rather than a delimiter: statement prose routinely contains pipes
    // (markdown tables), and any single-character separator can be forged by the
    // content it separates. This has no separator to collide with.
    const key = JSON.stringify([
      s.specPath,
      s.statementText,
      testCellFor(s),
      s.changedFile,
    ]);

    if (seen.has(key)) {
      return false;
    }
    seen.add(key);

    return true;
  });
}

/** One markdown table for a set of findings, capped. */
function statementTable(statements: ImpactStatement[]): string[] {
  const shown = statements.slice(0, MAX_ROWS);
  const hidden = statements.length - shown.length;

  return [
    "| Spec | Statement | Covering test | Changed file |",
    "|------|-----------|---------------|--------------|",
    ...shown.map(
      (s) =>
        `| ${s.specTitle}${sectionLabel(s.section)} | ${summarizeStatement(s.statementText)} | ${testCellFor(s)} | ${s.changedFile} |`,
    ),
    ...(hidden > 0 ? ["", `…and ${hidden} more.`] : []),
  ];
}

/**
 * Renders the sticky PR summary comment for an ImpactReport. The Action posts
 * this verbatim (find-by-marker, update-in-place) — all formatting lives here so
 * it is unit-tested, not buried in workflow YAML. Advisory tone, no blocking.
 */
export function buildImpactComment(report: ImpactReport): string {
  if (report.status === "unavailable") {
    return `${COMMENT_HEADER}\n\nGraph not available for this repo yet — skipping impact analysis. No action needed.\n\n${IMPACT_COMMENT_MARKER}\n`;
  }

  if (report.protocol !== undefined && report.protocol < 2) {
    return `${COMMENT_HEADER}\n\nThis repo's \`.github/workflows/lore-trace-impact.yml\` is version 1, which computed its diff against the base-branch tip instead of the merge base — so it reported every commit merged to the base since the branch point as a change of this PR. Findings from it were unreliable and are suppressed. Update the workflow to re-enable this check.\n\n${IMPACT_COMMENT_MARKER}\n`;
  }

  // A statement with no resolvable spec is a broken graph edge, not a finding —
  // rendering it produced the blank table rows in #1077.
  const findings = dedupeRows(
    report.statements.filter(
      (s) => s.specTitle || s.specPath || s.statementText,
    ),
  );
  const strong = findings.filter(
    (s) => s.evidence === "statement-edit" || s.evidence === "coverage",
  );
  const weak = findings.filter(
    (s) => s.evidence === "test-link" || s.evidence === "file-link",
  );

  // The empty result carries the same footer as a populated one. Without it a
  // run that skipped every file for want of a baseline is indistinguishable
  // from a run that looked properly and found nothing.
  if (!findings.length && !report.orphaned.length) {
    return [
      COMMENT_HEADER,
      "",
      describeExamined(report),
      "",
      `<sub>Deterministic · ${describeBaseline(report)} · no tests run by this check</sub>`,
      "",
      IMPACT_COMMENT_MARKER,
      "",
    ].join("\n");
  }

  const specCount = new Set(findings.map((s) => s.specPath)).size;
  const lines = [
    `${COMMENT_HEADER} — advisory`,
    "",
    `This PR touches **${findings.length} statement(s)** across **${specCount} spec(s)**.`,
  ];

  if (strong.length) {
    lines.push("", "### Coupled statements", ...statementTable(strong));
  }

  if (weak.length) {
    lines.push(
      "",
      `<details><summary>Weaker signals (${weak.length}) — linked by a spec, not proven by a test run</summary>`,
      "",
      ...statementTable(weak),
      "",
      "</details>",
    );
  }

  const notes = report.examined ? docNotes(report.examined) : [];

  if (notes.length) {
    lines.push("", notes.join(" "));
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

  lines.push(
    "",
    `<sub>Deterministic · ${describeBaseline(report)} · no tests run by this check</sub>`,
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

const IMPL_QUERY = `query q($repo: string, $fp: string) {
  chunks(func: eq(CodeChunk.file_path, $fp)) @filter(eq(CodeChunk.repo, $repo)) {
    CodeChunk.start_line
    CodeChunk.end_line
    stmts: ~Statement.implemented_by {
      ${STATEMENT_PROJECTION}
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
    // `end_line` has no producer: projectLinkedChunks writes only what the
    // author's `[label](src/x.ts#L12)` anchor carried. Demanding it made this
    // route compare [start, 0] and match nothing, ever. A `#L` anchor is a
    // navigation aid, not a maintained interval — so an unbounded chunk couples
    // the whole file, which is the claim the link actually makes.
    const spanKnown = start > 0 && end >= start;

    if (
      spanKnown &&
      !ranges.some(([s, e]) => intervalsOverlap(start, end, s, e))
    ) {
      continue;
    }

    for (const stmt of chunk.stmts ?? []) {
      out.push(toImpactStatement(stmt, file, [], "file-link"));
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
        ${STATEMENT_PROJECTION}
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
        out.push(toImpactStatement(stmt, file, [test], "coverage"));
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

export async function computeImpact(
  dgraph: DgraphClientPort | null,
  repo: string,
  changed: ChangedRange[],
  options: ImpactOptions = {},
): Promise<ImpactReport> {
  if (!dgraph) {
    return {
      status: "unavailable",
      statements: [],
      orphaned: [],
      testSelectors: [],
    };
  }

  // A protocol-1 client diffed against the base-branch tip, so its file list
  // carries everything merged to the base since the branch point. Publishing
  // findings from that input is how this check lost its readers; suppress and
  // say why instead.
  if ((options.protocol ?? 1) < 2) {
    return {
      status: "ok",
      protocol: 1,
      statements: [],
      orphaned: [],
      testSelectors: [],
      skipped: [{ path: "*", reason: "legacy-client" }],
    };
  }
  const raw: Array<ImpactStatement & { xid: string }> = [];
  const orphaned: OrphanStatement[] = [];
  const skipped: { path: string; reason: SkipReason }[] = [];
  const baseline = await readGraphBaseline(dgraph, repo);
  let withGraphData = 0;

  for (const file of changed) {
    // The graph's ranges belong to the baseline commit; `baseRanges` is the
    // diff's old side. They are the same coordinate system only when the file is
    // byte-identical at both commits, which is what `aligned` records. Without
    // that, line arithmetic is comparing two different numberings.
    const aligned = file.aligned === true && Boolean(baseline.commit);
    const lookupRanges = file.baseRanges ?? file.ranges;
    const found = [
      ...(await implementedByImpact(dgraph, repo, file.path, lookupRanges)),
      ...(await testFileImpact(dgraph, repo, file.path, lookupRanges, {
        fileLevel: !aligned,
      })),
      // Coverage facets and orphan footprints are line-precise with no
      // file-level fallback, so an unaligned file cannot use them at all.
      ...(aligned
        ? await validatedByImpact(dgraph, repo, file.path, lookupRanges)
        : []),
    ];

    if (!aligned) {
      skipped.push({
        path: file.path,
        reason: baseline.commit ? "unaligned" : "no-baseline",
      });
    }

    if (found.length) {
      withGraphData += 1;
    }
    raw.push(...found);

    if (aligned && file.deleted?.length) {
      orphaned.push(
        ...(await orphanImpact(dgraph, repo, file.path, file.deleted)),
      );
    }
  }

  // Doc-side: a changed spec couples through statement identity, not lines, so
  // this runs whatever the diff's coordinates look like.
  const docs = options.docs ?? [];
  let newStatements = 0;
  let changedWithoutTests = 0;

  for (const doc of docs) {
    const impact = await specFileImpact(dgraph, repo, doc.path, doc.content);

    newStatements += impact.added;
    changedWithoutTests += impact.changedWithoutTests;
    raw.push(...impact.statements);
  }
  const statements = mergeStatements(raw);
  const testSelectors = [
    ...new Set(statements.flatMap((s) => s.tests.map((t) => t.file))),
  ];

  return {
    status: "ok",
    protocol: options.protocol,
    coordinates: skipped.length ? "unverified" : "aligned",
    ...(skipped.length ? { skipped } : {}),
    statements,
    orphaned,
    testSelectors,
    ...(baseline.commit
      ? {
          graphCommit: baseline.commit,
          graphCommitAt: baseline.at ?? undefined,
        }
      : {}),
    examined: {
      files: changed.length,
      withGraphData,
      docs: docs.length,
      newStatements,
      changedWithoutTests,
    },
  };
}
