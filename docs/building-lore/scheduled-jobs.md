# Scheduled Jobs

**For people building Lore itself.** This is the registry of every recurring job the platform runs — what it does and when. The split between in-process and CronJob execution, and the two ingestion paths, are explained in [Architecture → Scheduling and ingestion](architecture.md#scheduling-and-ingestion); this page is the reference table behind that diagram.

---

| Job | Schedule | What it does |
|-----|----------|-------------|
| Context reindex | Daily 2 AM | Re-embed changed content for all repos (full crawl, deletes orphans) |
| Spec coverage validate | Daily 6 AM | Resolve spec→test links, file `spec-link-rot` issues on broken links |
| Gap detection | Monday 9 AM | Find missing documentation; fan out one gap-fill assembly line per onboarded repo |
| Spec drift | Monday 10 AM | Compare specs against actual code; fan out one spec-drift assembly line per repo with specs |
| Spec coverage backfill | Monday 11 AM | Find un-linked testable statements, open a PR per spec adding inline test links |
| Merge check | Every 60s | Detect merged PRs, trigger ingestion and the auto-merge / spec-status-upkeep hooks. The Floor emits the tick; the work runs in the **stations** service as `POST /api/stations/merge-check` |
| Approval check | Every 60s | Check for the `approved` label on tasks awaiting approval. Also a service station — `POST /api/stations/approval-check` |
| Spec task executor | Every 60s | Dispatch ready spec-tasks whose DAG dependencies have merged |
| Feature planning reaper | Every 60s | Recover feature-planning runs whose pod died or never reported |
| Assembly line reaper | Every 60s | The event-driven walk's liveness bound: resolve dropped node-terminal events, relaunch rowed-but-unlaunched CRs, time out stuck nodes, fail wedged rows |
| Agent watcher reconcile | Every 60s | Safety net for dropped Kubernetes Agent-CR watch events: re-emit terminal-unhandled runs, create PRs, prune CRs more than an hour past completion |
| Lease reaper | Every 60s | Delete leases more than 5 minutes past expiry, writing a `lease_expired` audit entry per row |
| LLM credit probe | Every 5m | Clear the LLM dispatch gate once the Anthropic account can answer again; a no-op while dispatch is allowed |
| Stale task check | Hourly (:17) | Fail or re-queue tasks stuck in a running state |
| Events prune | Hourly | Housekeeping of handled `pipeline.events` rows |
| Memory TTL | Every hour | Clean up expired memory entries |
| Eval runner | Daily 3 AM | Run PromptFoo evals for all teams, detect quality regressions |
| Context core builder | Daily 4 AM | Compare context quality to baseline, promote improvements |
| Importance decay | Daily 5 AM | Score memories by importance, evict low-value entries above the cap, clean up old invalidated facts |
| Consolidation | Daily 5:30 AM | Group recent facts by repo, extract higher-level patterns via Haiku, store as consolidated memories |
| Autoresearch | Monday 6 AM | Find low-confidence queries, generate context candidates, open PRs |
| Anthropic cost sync | Daily 7 AM | Reconcile Anthropic API usage and cost for the prior billing day |

The review-reactor (addressing reviewer feedback on PRs) is **not** a scheduled job — it is webhook/event-driven off GitHub PR-review events (ADR-015). The detection family (gap detection, spec drift, spec coverage validate/backfill) runs as in-process cron emitters that fan out per-repo assembly lines rather than executing the sweep inline (ADR-019 amendment).

An emitter never runs the job itself: it inserts a `cron.<name>.tick` event through the event-router, and the Floor's drain loop dispatches the registered handler. That indirection is what lets a handler live somewhere else entirely — merge check and approval check are ticks on the Floor and work in the stations service. The emitter set is single-sourced in `apps/floor/src/listeners/cron-emitters.ts`, and a cross-check test derives handler coverage from it, so an emitter added without a handler fails the build.

---

## See also

- [Architecture](architecture.md) — where these jobs run (in-process vs CronJob pods) and how ingestion reaches the vector store.
- [Back to README](../../README.md)
