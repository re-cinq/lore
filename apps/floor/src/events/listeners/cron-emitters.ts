/** The cron emitters, single-sourced — the registry cross-check test derives tick names from here, so a new emitter without a handler fails the build (ADR-019). */

export interface CronEmitter {
  name: string;
  schedule: string;
  /** Why this emitter exists — kept next to the schedule so intent survives edits. */
  note?: string;
}

export const CRON_EMITTERS: CronEmitter[] = [
  { name: "merge_check", schedule: "*/1 * * * *" },
  {
    name: "implementation_loop",
    schedule: "*/5 * * * *",
    note: "safety net for the backlog loop driver; the terminal hook re-emits it per repo for gapless re-arm",
  },
  {
    name: "pr_ready_check",
    schedule: "*/2 * * * *",
    note: "resume implementation-loop runs parked at await-pr once the PR is green and thread-clean",
  },
  { name: "approval_check", schedule: "*/1 * * * *" },
  { name: "spec_task_executor", schedule: "*/1 * * * *" },
  { name: "stale_task_check", schedule: "17 * * * *" },
  {
    name: "telemetry_prune",
    schedule: "43 3 * * *",
    note: "14-day reap of agent_run_events + pod_log_chunks; the ADR-037 window existed with no caller until pod_log_chunks needed one too",
  },
  { name: "feature_planning_reaper", schedule: "*/1 * * * *" },
  {
    name: "assembly_line_reaper",
    schedule: "*/1 * * * *",
    note: "event-driven walk liveness bound: resolve dropped node events, requeue lost claims, timeout, fail wedged rows",
  },
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
  {
    name: "llm_credit_probe",
    schedule: "*/5 * * * *",
    note: "clears the LLM dispatch gate once the Anthropic account can answer again; no-op while dispatch is allowed",
  },
  {
    name: "events_prune",
    schedule: "0 * * * *",
    note: "hourly housekeeping of handled event rows",
  },
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
