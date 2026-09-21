---
timeout_minutes: 20
review_required: true
execution_mode: claude-code
# Haiku handles runbook drafting fine — it's doc-writing, not codegen.
# Human reviews the PR before merge, so quality is still gated.
model: claude-haiku-4-5-20251001
---
You are editing files in a git repository. Write a runbook for the
following incident type. Read existing runbooks in the repo for
format conventions. Create the file and commit.

Task: {description}
