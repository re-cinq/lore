/** trace-impact — deterministic, zero-LLM PR-diff impact: walks the spec-traceability graph (CodeChunk/Coverage overlap → Statement) and flags orphaned-coverage statements. */

import type { DgraphClientPort } from "./deps.js";
import { mergeStatements, type ImpactStatement } from "./impact-statement.js";
import { testFileImpact } from "./impact-test-link.js";
import { readGraphBaseline } from "./graph-baseline.js";
import { specFileImpact } from "./impact-statement-delta.js";
import {
  implementedByImpact,
  validatedByImpact,
  orphanImpact,
} from "./impact-code-graph.js";
import type {
  ChangedRange,
  ImpactOptions,
  ImpactReport,
  OrphanStatement,
  SkipReason,
} from "./impact-types.js";

export { parseRanges } from "./line-range.js";
export type {
  ImpactStatement,
  Evidence,
  ChangeKind,
} from "./impact-statement.js";
export type {
  ChangedRange,
  SkipReason,
  OrphanStatement,
  ChangedDoc,
  ImpactOptions,
  ImpactReport,
  ImpactAnnotation,
} from "./impact-types.js";
export { buildImpactComment, IMPACT_COMMENT_MARKER } from "./impact-comment.js";
export { buildImpactAnnotations } from "./impact-annotations.js";

/** Everything the code-side sweep learned: coupled statements, statements orphaned by deleted lines, and the files whose coordinates could not be trusted. */
interface CodeImpact {
  raw: Array<ImpactStatement & { xid: string }>;
  orphaned: OrphanStatement[];
  skipped: { path: string; reason: SkipReason }[];
  withGraphData: number;
}

/** One changed source file against the graph. `baseRanges` (diff old-side) matches graph coordinates only when the file is byte-identical at both commits — what `aligned` records. */
async function fileImpact(
  dgraph: DgraphClientPort,
  repo: string,
  file: ChangedRange,
  aligned: boolean,
): Promise<Array<ImpactStatement & { xid: string }>> {
  const ranges = file.baseRanges ?? file.ranges;

  return [
    ...(await implementedByImpact(dgraph, repo, file.path, ranges)),
    ...(await testFileImpact(dgraph, repo, file.path, {
      ranges,
      fileLevel: !aligned,
    })),
    // Coverage facets and orphan footprints are line-precise with no file-level fallback, so an unaligned file cannot use them.
    ...(aligned
      ? await validatedByImpact(dgraph, repo, file.path, ranges)
      : []),
  ];
}

interface CodeImpactContext {
  dgraph: DgraphClientPort;
  repo: string;
  baselineCommit: string | null;
}

function skipReason(baselineCommit: string | null): SkipReason {
  return baselineCommit ? "unaligned" : "no-baseline";
}

/** Orphans for `file`'s deletions, or none when unaligned (untrustworthy coordinates) or nothing was deleted. */
async function orphansForFile(
  ctx: CodeImpactContext,
  file: ChangedRange,
  aligned: boolean,
): Promise<OrphanStatement[]> {
  const deleted = file.deleted ?? [];

  if (!aligned || deleted.length === 0) {
    return [];
  }

  return orphanImpact(ctx.dgraph, ctx.repo, file.path, deleted);
}

/** Runs one changed file against the graph and folds its findings into `result` in place. */
async function accumulateFileImpact(
  ctx: CodeImpactContext,
  file: ChangedRange,
  result: CodeImpact,
): Promise<void> {
  const { dgraph, repo, baselineCommit } = ctx;
  const aligned = file.aligned === true && Boolean(baselineCommit);
  const found = await fileImpact(dgraph, repo, file, aligned);

  if (!aligned) {
    result.skipped.push({
      path: file.path,
      reason: skipReason(baselineCommit),
    });
  }

  if (found.length) {
    result.withGraphData += 1;
  }
  result.raw.push(...found);
  result.orphaned.push(...(await orphansForFile(ctx, file, aligned)));
}

async function codeImpact(
  dgraph: DgraphClientPort,
  repo: string,
  changed: ChangedRange[],
  baselineCommit: string | null,
): Promise<CodeImpact> {
  const result: CodeImpact = {
    raw: [],
    orphaned: [],
    skipped: [],
    withGraphData: 0,
  };

  const ctx: CodeImpactContext = { dgraph, repo, baselineCommit };

  for (const file of changed) {
    await accumulateFileImpact(ctx, file, result);
  }

  return result;
}

/** Doc-side: a changed spec couples through statement identity, not lines, so this runs regardless of the diff's coordinates. */
async function docImpact(
  dgraph: DgraphClientPort,
  repo: string,
  docs: NonNullable<ImpactOptions["docs"]>,
) {
  const raw: Array<ImpactStatement & { xid: string }> = [];
  let newStatements = 0;
  let changedWithoutTests = 0;

  for (const doc of docs) {
    const impact = await specFileImpact(dgraph, repo, doc.path, doc.content);

    newStatements += impact.added;
    changedWithoutTests += impact.changedWithoutTests;
    raw.push(...impact.statements);
  }

  return { raw, newStatements, changedWithoutTests };
}

/** The signal a reviewer acts on: did this PR touch the tests that hold the statement up, or only the thing they were holding? */
function withTestsTouched(
  statements: Array<ImpactStatement & { xid: string }>,
  changed: ChangedRange[],
): ImpactStatement[] {
  const changedPaths = new Set(changed.map((file) => file.path));

  return mergeStatements(statements).map((stmt) => ({
    ...stmt,
    testsTouched: stmt.tests.some((test) => changedPaths.has(test.file)),
  }));
}

interface ImpactAssembly {
  options: ImpactOptions;
  changed: ChangedRange[];
  baseline: { commit: string | null; at: string | null };
  code: CodeImpact;
  doc: {
    raw: Array<ImpactStatement & { xid: string }>;
    newStatements: number;
    changedWithoutTests: number;
  };
  docsCount: number;
}

function assembleImpactReport({
  options,
  changed,
  baseline,
  code,
  doc,
  docsCount,
}: ImpactAssembly): ImpactReport {
  const statements = withTestsTouched([...code.raw, ...doc.raw], changed);

  return {
    status: "ok",
    protocol: options.protocol,
    coordinates: code.skipped.length ? "unverified" : "aligned",
    ...(code.skipped.length ? { skipped: code.skipped } : {}),
    statements,
    orphaned: code.orphaned,
    testSelectors: [
      ...new Set(statements.flatMap((s) => s.tests.map((t) => t.file))),
    ],
    ...(baseline.commit
      ? {
          graphCommit: baseline.commit,
          graphCommitAt: baseline.at ?? undefined,
        }
      : {}),
    examined: {
      files: changed.length,
      withGraphData: code.withGraphData,
      docs: docsCount,
      newStatements: doc.newStatements,
      changedWithoutTests: doc.changedWithoutTests,
    },
  };
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

  // A protocol-1 client diffed against the base-branch tip, so its file list carries everything merged to base since branch point; suppress rather than publish.
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
  const baseline = await readGraphBaseline(dgraph, repo);
  const code = await codeImpact(dgraph, repo, changed, baseline.commit);
  const docs = options.docs ?? [];
  const doc = await docImpact(dgraph, repo, docs);

  return assembleImpactReport({
    options,
    changed,
    baseline,
    code,
    doc,
    docsCount: docs.length,
  });
}
