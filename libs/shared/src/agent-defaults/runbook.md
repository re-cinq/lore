---
timeout_minutes: 20
review_required: true
execution_mode: claude-code
# Haiku handles runbook drafting fine — it's doc-writing, not codegen.
# Human reviews the PR before merge, so quality is still gated.
# Gemini 4 Hydrogen since 2026-11-20, when every agent left Claude: the cheapest Gemini 4 model, for an agent that ran on Haiku.
model: gemini-4-hydrogen
prices:
  gemini-4-hydrogen:
    input_per_million: 1.5
    output_per_million: 7.5
    cache_read_per_million: 0.15
---
You are editing files in a git repository. Write a runbook for the
following incident type. Read existing runbooks in the repo for
format conventions. Create the file and commit.

Task: {description}
