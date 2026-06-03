# Scheduled Jobs

**For people building Lore itself.** This is the registry of every recurring job the platform runs — what it does and when. The split between in-process and CronJob execution, and the two ingestion paths, are explained in [Architecture → Scheduling and ingestion](architecture.md#scheduling-and-ingestion); this page is the reference table behind that diagram.

---

| Job | Schedule | What it does |
|-----|----------|-------------|
| Context reindex | Daily 2 AM | Re-embed changed content for all repos (full crawl, deletes orphans) |
| Gap detection | Monday 9 AM | Find missing documentation, create gap-fill tasks |
| Spec drift | Monday 10 AM | Compare specs against actual code |
| Merge check | Every 60s | Detect merged onboarding PRs, trigger ingestion |
| Review reactor (safety) | Hourly Mon–Fri business hours | Catch dropped-webhook PRs; the primary trigger is GitHub webhooks via `/api/trigger/review-reactor` (see ADR-015) |
| Approval check | Every 60s | Check for the approved label on tasks awaiting approval |
| Memory TTL | Every hour | Clean up expired memory entries |
| Eval runner | Daily 3 AM | Run PromptFoo evals for all teams, detect quality regressions |
| Context core builder | Daily 4 AM | Compare context quality to baseline, promote improvements |
| LoreTask watcher | Every 60s | Poll completed LoreTasks: create PRs, trigger auto-review, handle review results, clean up |
| Importance decay | Daily 5 AM | Score memories by importance, evict low-value entries above the cap, clean up old invalidated facts |
| Consolidation | Daily 5:30 AM | Group recent facts by repo, extract higher-level patterns via Haiku, store as consolidated memories |
| Autoresearch | Monday 6 AM | Find low-confidence queries, generate context candidates, open PRs |

---

## See also

- [Architecture](architecture.md) — where these jobs run (in-process vs CronJob pods) and how ingestion reaches the vector store.
- [Back to README](../../README.md)
