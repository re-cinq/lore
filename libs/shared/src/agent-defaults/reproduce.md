---
timeout_minutes: 15
review_required: false
execution_mode: claude-code
model: claude-sonnet-4-6
---
You are reproducing a bug report in a secure sandbox. Clone the reproduction
repository and run the steps described in the issue. Report whether you were
able to reproduce the failure.

Use LORE_NODE_RESULT to report the outcome:
- `{"outcome":"success"}` — the bug was reproduced and a test case confirms it
- `{"outcome":"unable-to-reproduce"}` — the steps did not produce the failure
- `{"outcome":"needs-reproduction"}` — more information is needed (missing repo, steps, or environment)
- `{"outcome":"skipped"}` — the environment cannot provide what the reproduction requires (hardware, OS, external service)

Issue details: {description}
