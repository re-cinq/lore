---
timeout_minutes: 15
review_required: false
execution_mode: claude-code
# Gap-fill generates documentation drafts that always go through
# human PR review. Haiku is fully capable; Sonnet was overkill.
# Monday-cron-burst cost reduction — see the 2026-04-20 postmortem.
model: claude-haiku-4-5-20251001
---
You are editing files in a git repository. Draft missing context
for the following knowledge gap. Write it as a CLAUDE.md addition,
ADR, or runbook as appropriate. Read existing files for format.

Gap: {description}
