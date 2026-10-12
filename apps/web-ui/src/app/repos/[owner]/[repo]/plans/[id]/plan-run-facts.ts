import { fetchPrStatus, type PrStatus } from "@/lib/api/pr-status";
import {
  fetchAssemblyRunNodes,
  fetchPlanRun,
  type AssemblyRun,
} from "@/lib/assembly-runs";
import type { PlanRun } from "./PlanRunCard";

/** The plan's planning run with its visits, or null before one has started. Server-only (reads lore-api and GitHub); the detail page calls it at render, and `refreshPlanRunFactsAction` calls it again on demand so the client can refresh the facts a `RunStreamFrame` never carries (the spec analysis's question, the spec PR's title and threads) without a full page re-render. */
export async function planRunFor(
  repo: string,
  planId: string,
): Promise<PlanRun | null> {
  const run = await fetchPlanRun(repo, planId);

  if (!run) {
    return null;
  }
  const [nodes, pr] = await Promise.all([
    fetchAssemblyRunNodes(run.id),
    run.prNumber ? fetchPrStatus(repo, run.prNumber) : null,
  ]);

  return { ...planRunOf(run), nodes, ...specPrFactsOf(pr) };
}

type SpecPrFacts = Pick<PlanRun, "prTitle" | "prUnresolvedThreads">;

const UNASKED: SpecPrFacts = { prTitle: null, prUnresolvedThreads: null };

// What GitHub said about the spec PR, or nothing when nobody could ask.
function specPrFactsOf(pr: PrStatus | null): SpecPrFacts {
  return pr
    ? { prTitle: pr.title, prUnresolvedThreads: pr.unresolved_threads }
    : UNASKED;
}

function planRunOf(
  run: AssemblyRun,
): Omit<PlanRun, "nodes" | "prTitle" | "prUnresolvedThreads"> {
  const { id, status, outcome, reason, issueUrl, issueNumber } = run;

  return {
    id,
    status,
    outcome,
    reason,
    issueUrl,
    issueNumber,
    prUrl: run.prUrl,
    prNumber: run.prNumber,
    specPlanSummary: run.specPlanSummary ?? null,
  };
}
