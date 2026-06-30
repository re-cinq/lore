import { query } from "../../../kernel/db.js";
import { Llm, createDgraphClient } from "@re-cinq/lore-shared";
import { projectFor } from "../../../composition/project-boot.js";
import { taskStore } from "../../../kernel/queues.js";
import type { Project } from "@re-cinq/lore-shared";
import {
  isAssertionSource,
  shouldSkipDrift,
  decideGraphDrift,
  decideHeuristicDrift,
  type DriftedStatement,
  type HeuristicDriftDecision,
} from "./spec-drift-rules.js";

interface SpecChunk {
  id: string;
  repo: string;
  file_path: string;
  content: string;
}

interface CodeChunk {
  symbol_name: string;
  symbol_type: string;
  file_path: string;
}

interface Assertion {
  name: string;
  kind: "function" | "class" | "interface" | "type" | "endpoint" | "other";
  description: string;
}

/** Look-back window for "has this repo shipped anything?". */
const ACTIVITY_WINDOW_DAYS = 7;

/** Cap on drift tasks filed per run — a sweep must never dump a whole batch. */
const MAX_DRIFT_TASKS_PER_RUN = 10;

/**
 * Spec Drift Detection Job
 *
 * Runs weekly. For each spec in the chunk store:
 * 1. Graph-primary: when the spec is projected into the spec-trace graph, drift
 *    is decided from its per-statement violated/drifted flags (deterministic,
 *    statement-level — no symbol guessing). Authoritative when present.
 * 2. Heuristic fallback (spec not projected / no graph): LLM-extract testable
 *    assertions, match top-level symbol kinds against AST `symbol_name` chunks,
 *    flag drift past the divergence threshold AND the absolute miss floor.
 * 3. File a gap-fill task per drifted spec (stable-key dedup, per-run cap).
 *
 * Activity pre-filter (added 2026-04-17): skip specs in repos whose
 * code hasn't been re-ingested in the last ACTIVITY_WINDOW_DAYS days.
 * If a repo ships nothing, its code can't have drifted from its spec —
 * scanning it is pure LLM waste. The push-triggered lore-ingest.yml
 * workflow refreshes chunks.ingested_at on every merge to main, so
 * recent code-chunk activity is a reliable "something shipped" signal.
 */
export async function specDriftJob(): Promise<string> {
  // Get all spec chunks
  const specs = await query<SpecChunk>(
    `SELECT id, repo, file_path, content
     FROM org_shared.chunks
     WHERE content_type = 'spec'
     ORDER BY repo, file_path`,
  );

  if (specs.length === 0) {
    console.log("[job] spec-drift: no specs found in chunks");
    return "No specs found";
  }

  // Pre-filter: which repos have had code chunk updates in the window?
  const activeRepoRows = await query<{ repo: string }>(
    `SELECT DISTINCT repo
     FROM org_shared.chunks
     WHERE content_type = 'code'
       AND ingested_at > now() - ($1 || ' days')::interval`,
    [String(ACTIVITY_WINDOW_DAYS)],
  );
  const activeRepos = new Set(activeRepoRows.map((r) => r.repo));

  // Group specs by repo
  const byRepo = new Map<string, SpecChunk[]>();
  for (const spec of specs) {
    const list = byRepo.get(spec.repo) || [];
    list.push(spec);
    byRepo.set(spec.repo, list);
  }

  let totalChecked = 0;
  let totalDrift = 0;
  let skippedRepos = 0;
  let skippedSpecs = 0;
  let filteredDocs = 0;
  let filed = 0;
  let deferred = 0;

  // Graph-primary detection is authoritative where the spec-trace graph is
  // populated; without it (LORE_DGRAPH_HTTP unset) every spec uses the heuristic.
  const graphEnabled = !!createDgraphClient();

  for (const [repo, repoSpecs] of byRepo) {
    if (!activeRepos.has(repo)) {
      skippedRepos++;
      skippedSpecs += repoSpecs.length;
      console.log(
        `[job] spec-drift: skipping ${repo} — no code chunk updates in last ${ACTIVITY_WINDOW_DAYS}d (${repoSpecs.length} specs skipped)`,
      );
      continue;
    }
    // Get all code chunks for this repo with symbol metadata
    const codeChunks = await query<CodeChunk>(
      `SELECT
         metadata->>'symbol_name' AS symbol_name,
         metadata->>'symbol_type' AS symbol_type,
         file_path
       FROM org_shared.chunks
       WHERE repo = $1
         AND content_type = 'code'
         AND metadata->>'symbol_name' IS NOT NULL`,
      [repo],
    );

    // Build a set of known symbols for fast lookup
    const knownSymbols = new Set(
      codeChunks.map((c) => c.symbol_name.toLowerCase()),
    );

    const project = await projectFor(repo);
    const activeIssues = await fetchActiveIssues(project);

    for (const spec of repoSpecs) {
      // Skip prose artifacts (research/plan/tasks/quickstart) — they name
      // concepts, not code symbols, so they always read as 100% drifted.
      if (!isAssertionSource(spec.file_path)) {
        filteredDocs++;
        console.log(
          `[job] spec-drift: skipping ${repo}:${spec.file_path} — prose doc, not an assertion source`,
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
            repo,
            spec.file_path,
            copy,
            filed >= MAX_DRIFT_TASKS_PER_RUN,
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
          const graph = await detectGraphDrift(project, spec.file_path);
          if (graph?.available) {
            console.log(
              `[job] spec-drift: ${repo}:${spec.file_path} — graph: ${graph.statements.length} drifted statement(s)`,
            );
            if (graph.drifted) {
              await fileDrift(graphTaskCopy(spec.file_path, graph.statements));
            }
            continue; // graph is authoritative for this spec
          }
        }

        // Heuristic fallback (spec not projected / no graph): de-noised symbol
        // membership — only top-level symbol kinds, with an absolute miss floor.
        const assertions = await extractAssertions(spec.content, spec.file_path);
        if (assertions.length === 0) {
          console.log(`[job] spec-drift: ${repo}:${spec.file_path} — no assertions extracted`);
          continue;
        }
        const decision = decideHeuristicDrift(assertions, knownSymbols);
        console.log(
          `[job] spec-drift: ${repo}:${spec.file_path} — ${decision.scored} scorable, ${decision.missing.length} missing (${(decision.divergence * 100).toFixed(0)}%)`,
        );
        if (decision.drifted) {
          await fileDrift(heuristicTaskCopy(spec.file_path, decision));
        }
      } catch (err) {
        console.error(
          `[job] spec-drift: error processing ${repo}:${spec.file_path}:`,
          err,
        );
      }
    }
  }

  const activeRepoCount = byRepo.size - skippedRepos;
  const deferredNote = deferred > 0 ? `; deferred ${deferred} over the ${MAX_DRIFT_TASKS_PER_RUN}/run cap` : "";
  const summary = `Checked ${totalChecked} specs across ${activeRepoCount} active repos (${totalDrift} drifted${deferredNote}); skipped ${skippedSpecs} specs from ${skippedRepos} quiet repos, ${filteredDocs} prose docs`;
  console.log(`[job] spec-drift: ${summary}`);
  return summary;
}

async function extractAssertions(
  specContent: string,
  filePath: string,
): Promise<Assertion[]> {
  // Truncate spec content to avoid token limits
  const truncated = specContent.substring(0, 12000);

  const result = await Llm.instance.completeWithTool<{ assertions: Assertion[] }>({
    prompt: `Analyze this specification and extract testable assertions — concrete names of functions, classes, interfaces, types, or API endpoints that SHOULD exist in the codebase based on this spec.

Only extract items that are explicitly named in the spec. Do not infer or guess.

Spec file: ${filePath}
---
${truncated}`,
    systemPrompt:
      "You extract testable code assertions from specifications. Return only explicitly named items.",
    toolName: "extract_assertions",
    toolDescription: "Extract testable assertions from a spec",
    toolSchema: {
      type: "object",
      properties: {
        assertions: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: {
                type: "string",
                description: "The exact name of the function, class, type, or endpoint",
              },
              kind: {
                type: "string",
                enum: ["function", "class", "interface", "type", "endpoint", "other"],
              },
              description: {
                type: "string",
                description: "What this assertion checks for",
              },
            },
            required: ["name", "kind", "description"],
          },
        },
      },
      required: ["assertions"],
    },
    jobName: "spec_drift",
  });

  return result.data.assertions || [];
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
  repo: string,
  specPath: string,
  copy: DriftTaskCopy,
  atCap: boolean,
  activeIssues: Set<number> | null,
): Promise<FileOutcome> {
  // Dedup on the stable spec_path key (not the LLM-reworded title): skip when a
  // task is still in flight for this spec, or a resolved/failed one is within
  // its cooldown.
  const existing = await query<{ status: string; created_at: string; issue_number: number | null }>(
    `SELECT status, created_at, issue_number FROM pipeline.tasks
     WHERE target_repo = $1
       AND task_type = 'gap-fill'
       AND context_bundle->>'spec_path' = $2`,
    [repo, specPath],
  );

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
    console.log(`[job] spec-drift: deferring ${repo}:${specPath} — ${MAX_DRIFT_TASKS_PER_RUN}/run cap reached`);
    return "deferred";
  }

  await taskStore().create({
    description: copy.title,
    taskType: "gap-fill",
    targetRepo: repo,
    createdBy: "spec-drift",
    contextBundle: copy.bundle,
  });

  console.log(`[job] spec-drift: created gap-fill task for ${repo}:${specPath} (${copy.bundle.source})`);
  return "filed";
}
