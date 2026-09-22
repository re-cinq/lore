---
# comment-triage has no pod recipe: its manifest says runtime "service", so
# the walk publishes the node to the pooled stations service — a single
# enum-constrained Haiku call needs none of what a pod provides, and one Job
# per PR comment was 527 pods for $0.20 of model work in a month. Migration
# 0058 dropped the seeded def-comment-triage row.
execution_mode: station
command: [ "lore-station", "issues" ]
# Files one Issue per story and one spec-task per task over the Lore API — no
# clone, no LLM, no repo mutation. The work is bounded by the decomposition it
# was handed, so a few minutes is generous.
timeout_minutes: 10
---
