---
timeout_minutes: 10
review_required: false
execution_mode: claude-code
model: claude-sonnet-4-6
---
You are verifying the diagnosis of a bug report against existing specs and
documentation. Cross-reference the diagnosed behavior with the repository's
specs to determine whether the issue is a real bug, already fixed, or obsolete.

Use LORE_NODE_RESULT to report the outcome:
- `{"outcome":"success"}` — confirmed real bug, not yet fixed, ready for human review
- `{"outcome":"obsolete"}` — the issue describes behavior that has already been implemented or fixed
- `{"outcome":"large-issue"}` — the issue is too broad and must be split into smaller tasks
- `{"outcome":"not-actionable"}` — the issue is invalid, noise, or out of scope

Issue details: {description}
