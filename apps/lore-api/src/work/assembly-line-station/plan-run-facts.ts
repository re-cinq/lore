// What a `plan_run` message says of a run (specs/plan-detail-fast-open FR4): the facts the plan page read through the run list's row until now, built by the same mapping, plus the spec PR's title and open threads as GitHub last described them.

import type { AssemblyRunSummary } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-port.js";
import { toRunRow } from "../assembly-runs/run-row.js";
import { floorEnrichmentOf } from "../floor/floor-run-rows.js";
import type { PlanRunFacts } from "./run-stream-frame.js";

export type PrStatusRead = (
  repo: string,
  prNumber: number,
) => Promise<Record<string, unknown> | null>;

/** A planning run keeps no task, so its row needs no task join and no cost: its story, PR and question all come from the run itself. */
export function planRunFactsOf(
  run: AssemblyRunSummary,
  pr: Record<string, unknown> | null,
): PlanRunFacts {
  const row = toRunRow(run, floorEnrichmentOf(run, undefined));
  const prNumber = row.task_pr_number ?? row.args_pr_number;

  return {
    id: run.id,
    status: run.status,
    outcome: run.outcome,
    reason: run.reason,
    issue_url: row.issue_url,
    issue_number: row.issue_number,
    pr_url: row.pr_url ?? pullUrl(run.repo, prNumber),
    pr_number: prNumber,
    ...githubFacts(pr),
    spec_plan_summary: row.spec_plan_summary,
  };
}

/** The run's facts with its spec PR read from GitHub, when it has one. GitHub out of reach costs the PR its title and thread count, never the run: the page still draws the run without them. */
export async function readPlanRunFacts(
  run: AssemblyRunSummary,
  prStatus: PrStatusRead,
): Promise<PlanRunFacts> {
  const unread = planRunFactsOf(run, null);
  const pr = unread.pr_number
    ? await prStatus(run.repo, unread.pr_number).catch(() => null)
    : null;

  return pr ? planRunFactsOf(run, pr) : unread;
}

function pullUrl(repo: string, prNumber: number | null): string | null {
  return prNumber === null
    ? null
    : `https://github.com/${repo}/pull/${prNumber}`;
}

/** What GitHub said of the spec PR; nothing when nobody could ask. */
function githubFacts(
  pr: Record<string, unknown> | null,
): Pick<PlanRunFacts, "pr_title" | "pr_unresolved_threads"> {
  return {
    pr_title: typeof pr?.title === "string" ? pr.title : null,
    pr_unresolved_threads:
      typeof pr?.unresolved_threads === "number" ? pr.unresolved_threads : null,
  };
}
