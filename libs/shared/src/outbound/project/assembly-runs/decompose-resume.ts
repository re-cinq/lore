// When a spec PR merges, resumes the line waiting for it. Replaces decideDecomposeKick, whose task-type predicate silently stopped matching once the owning task became feature-planning — no feature on the merged line was ever decomposed (specs/6-dark-factory FR6.32). Nothing here mints anything; the line parks on a `merged` wait node after push, and merging is that node's outcome.

import type { EventReporter } from "../events/event-reporter-port.js";
import type { AssemblyRunsPort } from "./assembly-runs-port.js";
import type { RunGraph } from "../../../domain/run-graph.js";
import {
  parkedHumanNode,
  reportToParkedNode,
  type ParkedNode,
  type ParkedTarget,
} from "./parked-node.js";

/** The spec-PR park is a pr_review station, located by TYPE from the run's own graph — a hardcoded key here is what killed the pr_merged join before (FR6.32). */
const MERGED_STATION_TYPE = "pr_review";

/** Pre-clone fallback: the node id pushed lines parked on before runs carried their graph. */
const MERGED_NODE = "merged";

/** Pure: where to report a merge for one candidate line, or null when it isn't waiting for one. */
export function decideMergeResume(
  lineId: string,
  status: string | null,
  nodes: readonly ParkedNode[],
  graph: RunGraph | null,
): ParkedTarget | null {
  const parked = parkedHumanNode(status, nodes, graph, {
    type: MERGED_STATION_TYPE,
    fallbackNodeId: MERGED_NODE,
  });

  return parked
    ? { lineId, nodeId: parked.nodeId, iteration: parked.iteration }
    : null;
}

/** Pure: whether a closed-PR event should resume a line, and for which PR. Used to hang off handleMergedTask, which a running feature-planning task's PR-less row never reached; reading the merge off the event itself needs no task row. An unmerged close settles the line rather than resuming it. */
export function decideResumeFromClosedPr(
  params: Record<string, unknown>,
): MergedPr | null {
  const repo = params.repo;
  const prNumber = params.pr_number;

  if (params.merged !== true) {
    return null;
  }

  if (typeof repo !== "string" || typeof prNumber !== "number") {
    return null;
  }

  const baseRef = params.base_ref;

  return {
    repo,
    prNumber,
    ...(typeof baseRef === "string" && baseRef ? { baseRef } : {}),
  };
}

/** A merged PR, and the branch it merged into when the event carries it. */
export interface MergedPr {
  repo: string;
  prNumber: number;
  baseRef?: string;
}

export interface DecomposeResumeDeps {
  assemblyRuns: Pick<AssemblyRunsPort, "findOpenByPr" | "listStationRuns">;
  /** Delivers the resume; production binds the event reporter so this module never resolves one itself, a test records instead. */
  report: (
    target: ParkedTarget,
    outcome: "success",
    args?: Record<string, unknown>,
  ) => Promise<void>;
}

/** Bind the event reporter — the production `report`. */
export function eventReport(
  reporter: EventReporter,
): DecomposeResumeDeps["report"] {
  return (target, outcome, args) =>
    reportToParkedNode(reporter, target, {
      outcome,
      ...(args ? { args } : {}),
    });
}

/** Reports the merge to whichever open line for this PR is parked on its `merged` node; called for every merged task since a merged PR isn't labelled "spec PR" — safe because only a line actually parked on `merged` qualifies. */
export async function resumeDecomposition(
  pr: MergedPr,
  deps: DecomposeResumeDeps,
): Promise<void> {
  const open = await deps.assemblyRuns.findOpenByPr(pr.repo, pr.prNumber);

  for (const line of open) {
    const target = decideMergeResume(
      line.id,
      line.status,
      await deps.assemblyRuns.listStationRuns(line.id),
      line.graph,
    );

    if (!target) {
      continue;
    }

    await deps.report(target, "success", resumeArgs(pr));

    return;
  }
}

// The steps after the merge clone `args.ref` over the line's branch: the spec now lives on the branch the PR merged into, and GitHub deletes the merged head branch — decompose died on "pathspec did not match" cloning it (run 18773dbb, 2026-09-30).
function resumeArgs(pr: MergedPr): Record<string, unknown> | undefined {
  return pr.baseRef ? { ref: pr.baseRef } : undefined;
}
