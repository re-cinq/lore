import { extractAssertions } from "../spec-judge-llm.js";
import type { SpecChunkRow } from "../../outbound/project/chunks/chunks-port.js";
import type { Project } from "../../outbound/project/lib/project.js";
import {
  MAX_DRIFT_TASKS_PER_REPO_RUN,
  createDriftTask,
  graphTaskCopy,
  heuristicTaskCopy,
} from "./spec-drift-filing.js";
import {
  isAssertionSource,
  decideGraphDrift,
  decideHeuristicDrift,
} from "./spec-drift-rules.js";

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

export interface DriftTaskCopy {
  title: string;
  bundle: Record<string, unknown>;
}

export type FileOutcome = "filed" | "skipped" | "deferred";

export async function specDriftJob(opts: SpecDriftOptions): Promise<string> {
  const repo = opts.repoFilter;
  const project = opts.project;
  const specs = await project.chunks.specChunks();

  if (specs.length === 0) {
    console.log(`[job] spec-drift: no specs found for ${repo}`);

    return "No specs found";
  }

  const state = newDriftState();
  const ctx = await driftContext(project, repo);

  for (const spec of specs) {
    await processSpecDrift(ctx, spec, state);
  }

  const summary = driftSummary(state, repo);

  console.log(`[job] spec-drift: ${summary}`);

  return summary;
}

function newDriftState(): DriftRunState {
  return {
    totalChecked: 0,
    totalDrift: 0,
    filteredDocs: 0,
    filed: 0,
    deferred: 0,
  };
}

/** Spec Drift Detection Job (one repo per run, weekly via `cron.spec_drift.tick`): graph-primary drift detection per spec, falling back to LLM-assertion/symbol-membership heuristics, then files a gap-fill task per drifted spec (stable-key dedup, per-run cap). */
/** What every spec in this run is checked against. The symbol set is built ONCE and lowercased for membership tests — a spec naming a function that no longer exists is the heuristic's whole signal, and doing that lookup per spec would re-read the repo's symbols for each one. `graphEnabled` decides which detector is authoritative: with no LORE_DGRAPH_HTTP every spec falls back to the heuristic. */
async function driftContext(
  project: Project,
  repo: string,
): Promise<SpecDriftContext> {
  const codeChunks = await project.chunks.codeSymbols();

  return {
    project,
    repo,
    knownSymbols: new Set(codeChunks.map((c) => c.symbolName.toLowerCase())),
    activeIssues: await fetchActiveIssues(project),
    graphEnabled: !!process.env.LORE_DGRAPH_HTTP,
  };
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

async function processSpecDrift(
  ctx: SpecDriftContext,
  spec: SpecChunkRow,
  state: DriftRunState,
): Promise<void> {
  if (skipProseDoc(ctx, spec, state)) {
    return;
  }

  try {
    await detectDriftForSpec(ctx, spec, state);
  } catch (err) {
    console.error(
      `[job] spec-drift: error processing ${ctx.repo}:${spec.filePath}:`,
      err,
    );
  }
}

// Skip prose artifacts (research/plan/tasks/quickstart) — they always read as 100% drifted.
function skipProseDoc(
  ctx: SpecDriftContext,
  spec: SpecChunkRow,
  state: DriftRunState,
): boolean {
  if (isAssertionSource(spec.filePath)) {
    return false;
  }
  state.filteredDocs++;
  console.log(
    `[job] spec-drift: skipping ${ctx.repo}:${spec.filePath} — prose doc, not an assertion source`,
  );

  return true;
}

// Graph first, heuristic second; the graph short-circuits because it is authoritative when projected.
async function detectDriftForSpec(
  ctx: SpecDriftContext,
  spec: SpecChunkRow,
  state: DriftRunState,
): Promise<void> {
  state.totalChecked++;

  const fileDrift = makeFileDrift(ctx, spec, state);

  if (await tryGraphDrift(ctx, spec, fileDrift)) {
    return; // graph is authoritative for this spec
  }

  await tryHeuristicDrift(ctx, spec, fileDrift);
}

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

    tallyFileOutcome(outcome, state);
  };
}

// A filed drift is both a drift and a consumed budget slot; a deferred one is neither.
function tallyFileOutcome(outcome: FileOutcome, state: DriftRunState): void {
  if (outcome === "filed") {
    state.totalDrift++;
    state.filed++;

    return;
  }

  if (outcome === "deferred") {
    state.deferred++;
  }
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

/** Fetch the trace doc and decide drift from it; undefined on read failure. */
async function detectGraphDrift(project: Project, specPath: string) {
  try {
    const doc = await project.trace.document(specPath);

    return decideGraphDrift(doc);
  } catch {
    return undefined; // graph read failed → caller falls back to the heuristic
  }
}

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

  await applyHeuristicDrift(ctx, spec, assertions, fileDrift);
}

// Scores the extracted assertions against the repo's symbols and files the drift the score implies.
async function applyHeuristicDrift(
  ctx: SpecDriftContext,
  spec: SpecChunkRow,
  assertions: Awaited<ReturnType<typeof extractAssertions>>,
  fileDrift: FileDrift,
): Promise<void> {
  const decision = decideHeuristicDrift(assertions, ctx.knownSymbols);

  console.log(
    `[job] spec-drift: ${ctx.repo}:${spec.filePath} — ${decision.scored} scorable, ${decision.missing.length} missing (${(decision.divergence * 100).toFixed(0)}%)`,
  );

  if (decision.drifted) {
    await fileDrift(heuristicTaskCopy(spec.filePath, decision));
  }
}

// The deferral count is only mentioned when there is one — a "deferred 0" reads as a cap somebody hit.
function driftSummary(state: DriftRunState, repo: string): string {
  const deferredNote =
    state.deferred > 0
      ? `; deferred ${state.deferred} over the ${MAX_DRIFT_TASKS_PER_REPO_RUN}/run cap`
      : "";

  return `Checked ${state.totalChecked} specs in ${repo} (${state.totalDrift} drifted${deferredNote}); skipped ${state.filteredDocs} prose docs`;
}
