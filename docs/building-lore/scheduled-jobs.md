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
| Merge check | Every 60s | Detect merged PRs, trigger ingestion and the auto-merge / spec-status-upkeep hooks |
| Approval check | Every 60s | Check for the `approved` label on tasks awaiting approval |
| Agent watcher reconcile | Every 60s | Safety net for dropped Kubernetes Agent-CR watch events: re-emit terminal-unhandled runs, create PRs, prune |
| Memory TTL | Every hour | Clean up expired memory entries |
| Eval runner | Daily 3 AM | Run PromptFoo evals for all teams, detect quality regressions |
| Context core builder | Daily 4 AM | Compare context quality to baseline, promote improvements |
| Importance decay | Daily 5 AM | Score memories by importance, evict low-value entries above the cap, clean up old invalidated facts |
| Consolidation | Daily 5:30 AM | Group recent facts by repo, extract higher-level patterns via Haiku, store as consolidated memories |
| Autoresearch | Monday 6 AM | Find low-confidence queries, generate context candidates, open PRs |
| Anthropic cost sync | Daily 7 AM | Reconcile Anthropic API usage and cost for the prior billing day |

The review-reactor (addressing reviewer feedback on PRs) is **not** a scheduled job — it is webhook/event-driven off GitHub PR-review events (ADR-015). The detection family (gap detection, spec drift, spec coverage validate/backfill) runs as in-process cron emitters that fan out per-repo assembly lines rather than executing the sweep inline (ADR-019 amendment).

---

## See also

- [Architecture](architecture.md) — where these jobs run (in-process vs CronJob pods) and how ingestion reaches the vector store.
- [Back to README](../../README.md)
