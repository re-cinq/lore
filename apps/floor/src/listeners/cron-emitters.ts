/**
 * The cron emitters, single-sourced. Each entry is a scheduled tick that INSERTs a
 * `cron.<name>.tick` event; the loop dispatches the matching registry handler. This
 * is the one place the emitter set is declared — `index.ts` registers each on start,
 * and the registry cross-check test derives the tick names from it, so a new emitter
 * without a handler fails the build (the class of bug that let
 * `cron.agent_watcher_reconcile.tick` dead-letter unnoticed).
 *
 * Carve-out (ADR-019, amended): heavy batch jobs (reindex/eval/memory …) stay as
 * Kubernetes CronJobs. The detection family (spec_drift/gap_detection/
 * spec_coverage_*) moved here — their ticks fan out per-repo assembly-line runs
 * rather than running the sweep inline.
 */

export interface CronEmitter {
  name: string;
  schedule: string;
  /** Why this emitter exists — kept next to the schedule so intent survives edits. */
  note?: string;
}

export const CRON_EMITTERS: CronEmitter[] = [
  { name: "merge_check", schedule: "*/1 * * * *" },
  { name: "approval_check", schedule: "*/1 * * * *" },
  {
    name: "review_reactor",
    schedule: "7 7-17 * * 1-5",
    note: "safety net (webhook is primary); handler self-gates on business hours",
  },
  { name: "spec_task_executor", schedule: "*/1 * * * *" },
  { name: "stale_task_check", schedule: "17 * * * *" },
  { name: "feature_planning_reaper", schedule: "*/1 * * * *" },
  {
    name: "agent_watcher_reconcile",
    schedule: "*/1 * * * *",
    note: "safety net for dropped k8s watch events: re-emit terminal-unhandled CRs + prune",
  },
  {
    name: "lease_reaper",
    schedule: "* * * * *",
    note: "delete leases >5min past expiry, writing a lease_expired audit entry each",
  },
  { name: "events_prune", schedule: "0 * * * *", note: "hourly housekeeping of handled event rows" },
  {
    name: "gap_detection",
    schedule: "0 9 * * 1",
    note: "detection fan-out: one gap-detect assembly line per onboarded repo",
  },
  {
    name: "spec_drift",
    schedule: "0 10 * * 1",
    note: "detection fan-out: one spec-drift assembly line per active repo with specs",
  },
  {
    name: "spec_coverage_backfill",
    schedule: "0 11 * * 1",
    note: "detection fan-out: one backfill assembly line per active repo with specs",
  },
  {
    name: "spec_coverage_validate",
    schedule: "0 6 * * *",
    note: "detection fan-out: one link-validate assembly line per repo with specs",
  },
];

/** The `cron.<name>.tick` event names these emitters produce (the registry must cover each). */
export function cronTickEventNames(): string[] {
  return CRON_EMITTERS.map((e) => `cron.${e.name}.tick`);
}
