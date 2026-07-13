import { extractAssertions } from "../index.js";
import type { Project } from "../index.js";
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
  /** The repo this run covers. The fan-out (jobs/detect) enumerates active
   *  repos and starts one assembly-line run per repo. */
  repoFilter: string;
  /** The data facade to read/write through. Floor-side this is projectFor(repo)
   *  (Postgres); in a station pod it is createStationProject(env) (HTTP, no DB).
   *  Defaults to projectFor(repo) so existing Floor callers are unchanged. */
  project: Project;
}

/**
 * Spec Drift Detection Job — one repo per run.
 *
 * Runs as the `detect` node of the `spec-drift` assembly line, fanned out
 * weekly per active repo by the `cron.spec_drift.tick` handler (the activity
 * pre-filter lives in that fan-out). For each spec of the repo:
 * 1. Graph-primary: when the spec is projected into the spec-trace graph, drift
 *    is decided from its per-statement violated/drifted flags (deterministic,
 *    statement-level — no symbol guessing). Authoritative when present.
 * 2. Heuristic fallback (spec not projected / no graph): LLM-extract testable
 *    assertions, match top-level symbol kinds against AST `symbol_name` chunks,
 *    flag drift past the divergence threshold AND the absolute miss floor.
 * 3. File a gap-fill task per drifted spec (stable-key dedup, per-run cap).
 */
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
  const knownSymbols = new Set(codeChunks.map((c) => c.symbolName.toLowerCase()));

  const activeIssues = await fetchActiveIssues(project);

  let totalChecked = 0;
  let totalDrift = 0;
  let filteredDocs = 0;
  let filed = 0;
  let deferred = 0;

  // Graph-primary detection is authoritative where the spec-trace graph is
  // populated; without it (LORE_DGRAPH_HTTP unset) every spec uses the heuristic.
  // Probe the env directly rather than build-and-discard a Dgraph client.
  const graphEnabled = !!process.env.LORE_DGRAPH_HTTP;

  for (const spec of specs) {
    // Skip prose artifacts (research/plan/tasks/quickstart) — they name
    // concepts, not code symbols, so they always read as 100% drifted.
    if (!isAssertionSource(spec.filePath)) {
      filteredDocs++;
      console.log(
        `[job] spec-drift: skipping ${repo}:${spec.filePath} — prose doc, not an assertion source`,
      );
      continue;
    }
    try {
      totalChecked++;

      // File a drift task and fold the outcome into the run counters. The cap
      // is enforced inside createDriftTask after dedup, so a deduped spec
      // never burns the per-run budget or reads as deferred.
      const fileDrift = async (copy: DriftTaskCopy): Promise<void> => {
        const outcome = await createDriftTask(
          project,
          repo,
          spec.filePath,
          copy,
          filed >= MAX_DRIFT_TASKS_PER_REPO_RUN,
          activeIssues,
        );
        if (outcome === "filed") {
          totalDrift++;
          filed++;
        } else if (outcome === "deferred") {
          deferred++;
        }
      };

      // Graph-primary: when the spec is projected into the trace graph, its
      // per-statement violated/drifted flags are the authoritative signal —
      // deterministic and free of the symbol-membership false positives.
      if (graphEnabled) {
        const graph = await detectGraphDrift(project, spec.filePath);
        if (graph?.available) {
          console.log(
            `[job] spec-drift: ${repo}:${spec.filePath} — graph: ${graph.statements.length} drifted statement(s)`,
          );
          if (graph.drifted) {
            await fileDrift(graphTaskCopy(spec.filePath, graph.statements));
          }
          continue; // graph is authoritative for this spec
        }
      }

      // Heuristic fallback (spec not projected / no graph): de-noised symbol
      // membership — only top-level symbol kinds, with an absolute miss floor.
      const assertions = await extractAssertions(spec.content, spec.filePath, { jobName: "spec_drift" });
      if (assertions.length === 0) {
        console.log(`[job] spec-drift: ${repo}:${spec.filePath} — no assertions extracted`);
        continue;
      }
      const decision = decideHeuristicDrift(assertions, knownSymbols);
      console.log(
        `[job] spec-drift: ${repo}:${spec.filePath} — ${decision.scored} scorable, ${decision.missing.length} missing (${(decision.divergence * 100).toFixed(0)}%)`,
      );
      if (decision.drifted) {
        await fileDrift(heuristicTaskCopy(spec.filePath, decision));
      }
    } catch (err) {
      console.error(
        `[job] spec-drift: error processing ${repo}:${spec.filePath}:`,
        err,
      );
    }
  }

  const deferredNote = deferred > 0 ? `; deferred ${deferred} over the ${MAX_DRIFT_TASKS_PER_REPO_RUN}/run cap` : "";
  const summary = `Checked ${totalChecked} specs in ${repo} (${totalDrift} drifted${deferredNote}); skipped ${filteredDocs} prose docs`;
  console.log(`[job] spec-drift: ${summary}`);
  return summary;
}

interface DriftTaskCopy {
  title: string;
  bundle: Record<string, unknown>;
}

type FileOutcome = "filed" | "skipped" | "deferred";

/** Fetch the trace doc and decide drift from it; undefined on read failure. */
async function detectGraphDrift(project: Project, specPath: string) {
  try {
    const doc = await project.trace.document(specPath);
    return decideGraphDrift(doc);
  } catch {
    return undefined; // graph read failed → caller falls back to the heuristic
  }
}

/**
 * Open issue numbers for the repo that aren't dead `lore-failed`, fetched once
 * per repo so the dedup check doesn't re-list every issue per spec. Null when
 * the platform read fails — callers fall back to the DB dedup only.
 */
async function fetchActiveIssues(project: Project): Promise<Set<number> | null> {
  try {
    const open = await project.issues.list({ state: "open" });
    return new Set(open.filter((i) => !i.labels.includes("lore-failed")).map((i) => i.number));
  } catch {
    return null;
  }
}

/**
 * Issue copy + context bundle for a graph-detected drift (statement-level). The
 * drifted statements (with their links) ride in the bundle; the issue body is
 * rendered from them by issue-body.ts after the LLM copy pass.
 */
function graphTaskCopy(specPath: string, statements: DriftedStatement[]): DriftTaskCopy {
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
function heuristicTaskCopy(specPath: string, decision: HeuristicDriftDecision): DriftTaskCopy {
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

async function createDriftTask(
  project: Project,
  repo: string,
  specPath: string,
  copy: DriftTaskCopy,
  atCap: boolean,
  activeIssues: Set<number> | null,
): Promise<FileOutcome> {
  // Dedup on the stable spec_path key (not the LLM-reworded title): skip when a
  // task is still in flight for this spec, or a resolved/failed one is within
  // its cooldown.
  const existing = await project.tasks.driftTasksForSpec("gap-fill", specPath);

  if (shouldSkipDrift(existing, new Date())) {
    console.log(
      `[job] spec-drift: skipping ${repo}:${specPath} — ${existing.length} existing task(s), in flight or within cooldown`,
    );
    return "skipped";
  }

  if (activeIssues && existing.some((e) => e.issue_number !== null && activeIssues.has(e.issue_number))) {
    console.log(`[job] spec-drift: skipping ${repo}:${specPath} — an open issue already tracks it`);
    return "skipped";
  }

  // Cap is the last gate, after dedup: only specs that would genuinely be filed
  // count against the per-run budget, so a deduped spec never burns it.
  if (atCap) {
    console.log(`[job] spec-drift: deferring ${repo}:${specPath} — ${MAX_DRIFT_TASKS_PER_REPO_RUN}/run cap reached`);
    return "deferred";
  }

  await project.tasks.create({
    description: copy.title,
    taskType: "gap-fill",
    targetRepo: repo,
    createdBy: "spec-drift",
    contextBundle: copy.bundle,
  });

  console.log(`[job] spec-drift: created gap-fill task for ${repo}:${specPath} (${copy.bundle.source})`);
  return "filed";
}
