---
execution_mode: station
command: [ "lore-station", "detect" ]
timeout_minutes: 30
# spec_drift extracts assertions with a model when a spec is not in the graph,
# and spec_coverage_backfill judges every candidate link with one. Without the
# credential those paths error per spec -- logged, unlike comment-triage's
# silent swallow, but the work still does not happen.
needs_model: true
---
