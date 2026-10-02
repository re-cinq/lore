# Scheduled Jobs

**For people building Lore itself.** This is the registry of every recurring job the platform runs — what it does and when. The split between in-process and CronJob execution, and the two ingestion paths, are explained in [Architecture → Scheduling and ingestion](architecture.md#scheduling-and-ingestion); this page is the reference table behind that diagram.

---

| Job | Schedule (UTC) | Runs as | What it does |
|-----|----------------|---------|-------------|
| Merge check | Every minute | tick → sweep | Finds tasks whose pull request merged or closed, and starts the `merge` line on the external floor for a merged one |
| PR ready check | Every 2 minutes | tick → sweep | Reads CI and review state for the runs waiting on their pull request, and reports the verdict to the parked visit |
| Implementation loop | Every 5 minutes | tick → sweep | Picks the next backlog ticket per repository and starts its run on the external floor |
| Spec task executor | Every minute | tick → sweep | Starts a run for each plan spec-task whose dependencies have merged |
| Daily digest | Every 15 minutes | tick → sweep | Starts the digest line for each Slack channel whose configured time has come |
| Spec upkeep | Monday 10:00 | tick → sweep | Starts one spec-upkeep run per onboarded repository: fix drifted specs, add missing test links, open one pull request |
| Events prune | Hourly | tick → sweep | Housekeeping of handled `pipeline.events` rows and their deliveries |
| Telemetry prune | Daily 03:43 | tick → sweep | 14-day reap of agent run events and stored pod log chunks |
| Memory TTL | Hourly | courier CronJob | Deletes memories whose TTL has passed |
| Importance decay | Daily 05:00 | courier CronJob | Scores memories, evicts the lowest above the cap, marks unretrieved facts stale |
| Consolidation | Daily 05:30 | courier CronJob | Groups the week's facts by repository and stores the patterns a model extracts from them |
| Anthropic cost sync | Daily 07:00 | courier CronJob | Reconciles Anthropic usage and cost for the prior billing day |
| GCP cost sync | Daily 08:00 | courier CronJob | Reconciles GCP cost for the `/spend` page |

**Tick → sweep**: the stations service writes a `cron.<name>.tick` event to `pipeline.events` from its own database pool (`libs/shared/src/work/scheduler/cron-emitters.ts`), claims its own delivery, and runs the sweep that declared that tick. **Courier CronJob**: a Kubernetes CronJob that posts `POST /api/stations/<name>` on the stations service and exits ([ADR-019](../../adrs/ADR-019-scheduled-job-runtime-split.md)).

What is not on a schedule: reviews and plans start from GitHub and UI events; specs, ADRs and test reports reach the stores from CI on every push to `main`.

Removed with Lore's own Floor on 2026-10-02: the nightly reindex, gap detection, spec drift, spec coverage validate and backfill (the last three are a CI check and the spec-upkeep line now), the approval check, the reapers and reconcilers of the old walk, and the eval and autoresearch jobs.

---

## See also

- [Architecture](architecture.md) — where these jobs run (in-process vs CronJob pods) and how ingestion reaches the vector store.
- [Back to README](../../README.md)
