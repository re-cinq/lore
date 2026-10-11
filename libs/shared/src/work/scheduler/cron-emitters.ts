/** The cron emitters, single-sourced: the stations service emits them and answers every one. */

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
  {
    name: "telemetry_prune",
    schedule: "43 3 * * *",
    note: "14-day reap of agent_run_events + pod_log_chunks; the ADR-037 window existed with no caller until pod_log_chunks needed one too",
  },
  {
    name: "events_prune",
    schedule: "0 * * * *",
    note: "hourly housekeeping of handled event rows",
  },
  {
    name: "daily_digest",
    schedule: "*/15 * * * *",
    note: "coarse tick; each repo's time, days and timezone live in settings.digest, the watermark in lore.digest_posts; one run per Slack channel (ADR-019 amendment 2026-09-25)",
  },
  {
    name: "spec_upkeep",
    schedule: "0 10 * * 1",
    note: "one spec-upkeep run per onboarded repo on the external floor, started by the stations service; it replaced the spec_drift and spec_coverage_backfill fan-outs",
  },
  {
    name: "issue_triage",
    schedule: "*/2 * * * *",
    note: "batch sweep that starts one issue-triage floor run per qualifying triage: needs-triage issue per repo, oldest first, up to the per-repo concurrency cap (specs/issue-triage FR9)",
  },
];

/** The `cron.<name>.tick` event names these emitters produce (the registry must cover each). */
export function cronTickEventNames(): string[] {
  return CRON_EMITTERS.map((e) => `cron.${e.name}.tick`);
}
