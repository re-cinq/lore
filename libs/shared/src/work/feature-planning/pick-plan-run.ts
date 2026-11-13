// Which of a plan's planning runs its page follows (specs/7-feature-planning, specs/plan-detail-fast-open FR4): the one rule the plan page and its live channel share.

const OPEN_STATUSES = new Set(["queued", "running"]);
const CANCELLED = "cancelled";

export interface PlanRunCandidate {
  status: string;
  outcome: string | null;
}

/** The plan's open run, else its newest that was not cancelled, else its newest; null before any started. `runs` is newest first. A newer run can be over while an older one was reopened, and a shell run a migration cancelled must not hide the run that did the work. */
export function pickPlanRun<Run extends PlanRunCandidate>(
  runs: readonly Run[],
): Run | null {
  return (
    runs.find((run) => OPEN_STATUSES.has(run.status)) ??
    runs.find((run) => run.outcome !== CANCELLED) ??
    runs.at(0) ??
    null
  );
}
