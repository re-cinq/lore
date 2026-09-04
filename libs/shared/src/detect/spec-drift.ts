import { extractAssertions } from "../index.js";
import type { Project, SpecChunkRow } from "../index.js";
import {
  isAssertionSource,
  shouldSkipDrift,
  decideGraphDrift,
  decideHeuristicDrift,
  type DriftedStatement,
  type HeuristicDriftDecision,
} from "./spec-drift-rules.js";

/** Cap on drift tasks filed per repo run — one repo must never dump a whole batch. */
const MAX_DRIFT_TASKS_PER_REPO_RUN = 3;

export interface SpecDriftOptions {
  /** The repo this run covers, one assembly-line run per repo via the jobs/detect fan-out. */
  repoFilter: string;
  /** The data facade to read/write through — Postgres Floor-side, HTTP (no DB) in a station pod. */
  project: Project;
}

interface DriftRunState {
  totalChecked: number;
  totalDrift: number;
  filteredDocs: number;
  filed: number;
  deferred: number;
}

interface SpecDriftContext {
  project: Project;
  repo: string;
  knownSymbols: Set<string>;
  activeIssues: Set<number> | null;
  graphEnabled: boolean;
}

type FileDrift = (copy: DriftTaskCopy) => Promise<void>;

// Cap is enforced inside createDriftTask after dedup, so a deduped spec never burns the per-run budget.
function makeFileDrift(
  ctx: SpecDriftContext,
  spec: SpecChunkRow,
  state: DriftRunState,
): FileDrift {
  return async (copy: DriftTaskCopy): Promise<void> => {
    const outcome = await createDriftTask(
      ctx.project,
      { repo: ctx.repo, path: spec.filePath },
      copy,
      {
        atCap: state.filed >= MAX_DRIFT_TASKS_PER_REPO_RUN,
        activeIssues: ctx.activeIssues,
      },
    );

    if (outcome === "filed") {
      state.totalDrift++;
      state.filed++;

      return;
    }

    if (outcome === "deferred") {
      state.deferred++;
    }
  };
}

// Graph-primary: when projected, per-statement violated/drifted flags are authoritative (deterministic, no symbol-membership false positives). True when the graph was authoritative for this spec.
async function tryGraphDrift(
  ctx: SpecDriftContext,
  spec: SpecChunkRow,
  fileDrift: FileDrift,
): Promise<boolean> {
  const graph = ctx.graphEnabled
    ? await detectGraphDrift(ctx.project, spec.filePath)
    : null;

  return applyGraphDrift(graph, ctx.repo, spec.filePath, fileDrift);
}

// Heuristic fallback: de-noised symbol membership — top-level kinds only, with an absolute miss floor.
async function tryHeuristicDrift(
  ctx: SpecDriftContext,
  spec: SpecChunkRow,
  fileDrift: FileDrift,
): Promise<void> {
  const assertions = await extractAssertions(spec.content, spec.filePath, {
    jobName: "spec_drift",
  });

  if (assertions.length === 0) {
    console.log(
      `[job] spec-drift: ${ctx.repo}:${spec.filePath} — no assertions extracted`,
    );

    return;
  }
  const decision = decideHeuristicDrift(assertions, ctx.knownSymbols);

  console.log(
    `[job] spec-drift: ${ctx.repo}:${spec.filePath} — ${decision.scored} scorable, ${decision.missing.length} missing (${(decision.divergence * 100).toFixed(0)}%)`,
  );

  if (decision.drifted) {
    await fileDrift(heuristicTaskCopy(spec.filePath, decision));
  }
}

async function processSpecDrift(
  ctx: SpecDriftContext,
  spec: SpecChunkRow,
  state: DriftRunState,
): Promise<void> {
  // Skip prose artifacts (research/plan/tasks/quickstart) — they always read as 100% drifted.
  if (!isAssertionSource(spec.filePath)) {
    state.filteredDocs++;
    console.log(
      `[job] spec-drift: skipping ${ctx.repo}:${spec.filePath} — prose doc, not an assertion source`,
    );

    return;
  }

  try {
    state.totalChecked++;

    const fileDrift = makeFileDrift(ctx, spec, state);

    if (await tryGraphDrift(ctx, spec, fileDrift)) {
      return; // graph is authoritative for this spec
    }

    await tryHeuristicDrift(ctx, spec, fileDrift);
  } catch (err) {
    console.error(
      `[job] spec-drift: error processing ${ctx.repo}:${spec.filePath}:`,
      err,
    );
  }
}

/** Spec Drift Detection Job (one repo per run, weekly via `cron.spec_drift.tick`): graph-primary drift detection per spec, falling back to LLM-assertion/symbol-membership heuristics, then files a gap-fill task per drifted spec (stable-key dedup, per-run cap). */
export async function specDriftJob(opts: SpecDriftOptions): Promise<string> {
  const repo = opts.repoFilter;
  const project = opts.project;
  const specs = await project.chunks.specChunks();

  if (specs.length === 0) {
    console.log(`[job] spec-drift: no specs found for ${repo}`);

    return "No specs found";
  }

  // All code chunks for the repo with symbol metadata, for fast membership checks.
  const codeChunks = await project.chunks.codeSymbols();
  const knownSymbols = new Set(
    codeChunks.map((c) => c.symbolName.toLowerCase()),
  );

  const activeIssues = await fetchActiveIssues(project);

  // Graph-primary detection is authoritative when populated; without LORE_DGRAPH_HTTP every spec falls back to the heuristic.
  const graphEnabled = !!process.env.LORE_DGRAPH_HTTP;

  const state: DriftRunState = {
    totalChecked: 0,
    totalDrift: 0,
    filteredDocs: 0,
    filed: 0,
    deferred: 0,
  };
  const ctx: SpecDriftContext = {
    project,
    repo,
    knownSymbols,
    activeIssues,
    graphEnabled,
  };

  for (const spec of specs) {
    await processSpecDrift(ctx, spec, state);
  }

  const deferredNote =
    state.deferred > 0
      ? `; deferred ${state.deferred} over the ${MAX_DRIFT_TASKS_PER_REPO_RUN}/run cap`
      : "";
  const summary = `Checked ${state.totalChecked} specs in ${repo} (${state.totalDrift} drifted${deferredNote}); skipped ${state.filteredDocs} prose docs`;

  console.log(`[job] spec-drift: ${summary}`);

  return summary;
}

interface DriftTaskCopy {
  title: string;
  bundle: Record<string, unknown>;
}

type FileOutcome = "filed" | "skipped" | "deferred";

/** Act on a graph-primary drift verdict; true when the graph was authoritative so the heuristic must be skipped. */
async function applyGraphDrift(
  graph: Awaited<ReturnType<typeof detectGraphDrift>> | null,
  repo: string,
  specFilePath: string,
  fileDrift: (copy: DriftTaskCopy) => Promise<void>,
): Promise<boolean> {
  if (!graph?.available) {
    return false;
  }

  console.log(
    `[job] spec-drift: ${repo}:${specFilePath} — graph: ${graph.statements.length} drifted statement(s)`,
  );

  if (graph.drifted) {
    await fileDrift(graphTaskCopy(specFilePath, graph.statements));
  }

  return true;
}

/** Fetch the trace doc and decide drift from it; undefined on read failure. */
async function detectGraphDrift(project: Project, specPath: string) {
  try {
    const doc = await project.trace.document(specPath);

    return decideGraphDrift(doc);
  } catch {
    return undefined; // graph read failed → caller falls back to the heuristic
  }
}

/** Open issue numbers for the repo that aren't dead `lore-failed`, fetched once per repo; null on read failure (callers fall back to DB dedup). */
async function fetchActiveIssues(
  project: Project,
): Promise<Set<number> | null> {
  try {
    const open = await project.issues.list({ state: "open" });

    return new Set(
      open
        .filter((i) => !i.labels.includes("lore-failed"))
        .map((i) => i.number),
    );
  } catch {
    return null;
  }
}

/** Issue copy + context bundle for a graph-detected drift; drifted statements ride in the bundle and issue-body.ts renders the body from them. */
function graphTaskCopy(
  specPath: string,
  statements: DriftedStatement[],
): DriftTaskCopy {
  const shown = statements.slice(0, 20);

  return {
    title: `Spec drift: ${specPath} (${statements.length} statement${statements.length === 1 ? "" : "s"})`,
    bundle: {
      spec_path: specPath,
      source: "graph",
      remediation: "update-spec",
      statement_count: statements.length,
      drifted_statements: shown,
    },
  };
}

/** Issue copy + context bundle for a heuristic-detected drift (symbol membership). */
function heuristicTaskCopy(
  specPath: string,
  decision: HeuristicDriftDecision,
): DriftTaskCopy {
  const pct = (decision.divergence * 100).toFixed(0);

  return {
    title: `Spec drift: ${specPath} (${pct}% divergence)`,
    bundle: {
      spec_path: specPath,
      source: "heuristic",
      remediation: "update-spec",
      scored: decision.scored,
      missing_count: decision.missing.length,
      divergence: decision.divergence,
      missing_symbols: decision.missing.slice(0, 20),
    },
  };
}

/** The per-run filing state every drift task is weighed against. */
interface DriftFiling {
  atCap: boolean;
  activeIssues: Set<number> | null;
}

async function createDriftTask(
  project: Project,
  { repo, path: specPath }: { repo: string; path: string },
  copy: DriftTaskCopy,
  { atCap, activeIssues }: DriftFiling,
): Promise<FileOutcome> {
  // Dedup on the stable spec_path key (not the LLM-reworded title): skip when in flight or within cooldown.
  const existing = await project.tasks.driftTasksForSpec("gap-fill", specPath);

  if (shouldSkipDrift(existing, new Date())) {
    console.log(
      `[job] spec-drift: skipping ${repo}:${specPath} — ${existing.length} existing task(s), in flight or within cooldown`,
    );

    return "skipped";
  }

  if (
    activeIssues &&
    existing.some(
      (e) => e.issue_number !== null && activeIssues.has(e.issue_number),
    )
  ) {
    console.log(
      `[job] spec-drift: skipping ${repo}:${specPath} — an open issue already tracks it`,
    );

    return "skipped";
  }

  // Cap is the last gate, after dedup: only specs that would genuinely be filed count against the per-run budget.
  if (atCap) {
    console.log(
      `[job] spec-drift: deferring ${repo}:${specPath} — ${MAX_DRIFT_TASKS_PER_REPO_RUN}/run cap reached`,
    );

    return "deferred";
  }

  await project.tasks.create({
    description: copy.title,
    taskType: "gap-fill",
    targetRepo: repo,
    createdBy: "spec-drift",
    contextBundle: copy.bundle,
  });

  console.log(
    `[job] spec-drift: created gap-fill task for ${repo}:${specPath} (${copy.bundle.source})`,
  );

  return "filed";
}
