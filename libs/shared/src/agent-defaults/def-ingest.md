---
execution_mode: station
command: [ "lore-station", "ingest" ]
# Sized for a push that rewrites several 100 KB specs (re-cinq/Otto, 2026-09-28:
# 5 changed specs took 9.5 min against a 10-minute budget); whole-repo passes
# never reach a pod (the Floor chunks force runs first).
timeout_minutes: 30
env:
  # The ONLY station type with dgraph reach — matched by the label-scoped
  # ingest-station-egress NetworkPolicy (specs/ingest-station FR4). Same
  # value the Floor uses; deterministic signed binary, no repo code, no LLM.
  LORE_DGRAPH_HTTP: "http://lore-dgraph-alpha.lore-dgraph.svc.cluster.local:8080"
pod_labels:
  # The dgraph-egress marker ingest-station-egress selects. A pod TEMPLATE
  # label on purpose: the per-task triple renames the Station to pt-<id>,
  # so the policy's old station-name selector stopped matching the moment
  # clones landed (every pod hung to its deadline, 2026-07-17).
  lore.re-cinq.com/dgraph-egress: "true"
---
