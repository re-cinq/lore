/** Turning a detected drift into a gap-fill task: what the Issue says, and the three gates it must pass first. */

import type { Project } from "../../outbound/project/lib/project.js";
import type { DriftTaskCopy, FileOutcome } from "./spec-drift.js";
import {
  shouldSkipDrift,
  type DriftedStatement,
  type HeuristicDriftDecision,
} from "./spec-drift-rules.js";

/** Cap on drift tasks filed per repo run — one repo must never dump a whole batch. */
export const MAX_DRIFT_TASKS_PER_REPO_RUN = 3;

/** Issue copy + context bundle for a graph-detected drift; drifted statements ride in the bundle and issue-body.ts renders the body from them. */
export function graphTaskCopy(
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
export function heuristicTaskCopy(
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

/** Whether this drift is already being handled — by a task in flight or within cooldown, or by an Issue somebody has open. Both count: a task that finished and an Issue still open mean the same thing to a human, and filing again would produce a second ticket for one problem. */
function alreadyTracked(
  existing: Awaited<ReturnType<Project["tasks"]["driftTasksForSpec"]>>,
  activeIssues: DriftFiling["activeIssues"],
  { repo, specPath }: { repo: string; specPath: string },
): boolean {
  if (shouldSkipDrift(existing, new Date())) {
    console.log(
      `[job] spec-drift: skipping ${repo}:${specPath} — ${existing.length} existing task(s), in flight or within cooldown`,
    );

    return true;
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

    return true;
  }

  return false;
}

async function driftFilingGate(
  project: Project,
  { repo, specPath }: { repo: string; specPath: string },
  { atCap, activeIssues }: DriftFiling,
): Promise<FileOutcome | null> {
  const existing = await project.tasks.driftTasksForSpec("gap-fill", specPath);

  if (alreadyTracked(existing, activeIssues, { repo, specPath })) {
    return "skipped";
  }

  if (atCap) {
    console.log(
      `[job] spec-drift: deferring ${repo}:${specPath} — ${MAX_DRIFT_TASKS_PER_REPO_RUN}/run cap reached`,
    );

    return "deferred";
  }

  return null;
}

export async function createDriftTask(
  project: Project,
  { repo, path: specPath }: { repo: string; path: string },
  copy: DriftTaskCopy,
  { atCap, activeIssues }: DriftFiling,
): Promise<FileOutcome> {
  const gate = await driftFilingGate(
    project,
    { repo, specPath },
    {
      atCap,
      activeIssues,
    },
  );

  if (gate) {
    return gate;
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
