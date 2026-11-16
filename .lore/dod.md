# Definition of Done

> Proposal: add a Prometheus rule to the kube-prometheus-stack (ADR-050), firing when any PVC in `utopia` or `lore-db` stays above 80% for 15 minutes, using `kubelet_volume_stats_used_bytes / kubelet_volume_stats_capacity_bytes`. Show it on a Grafana panel.

**Strategy: `mechanical`** — The ticket is a fully-specified configuration edit that owes no new behavioural test; the existing Helm render checks must stay green. The CI job `lore-platform-render` runs the tests since Helm is missing in this pod.

## Done when these pass

- [ ] **Helm render checks** — existing tests validate the new PrometheusRule and JSON panel are well-formed without syntax errors.
  `scripts/check-lore-platform-render.sh`

## Facets

- [ ] Add `DatabaseVolumeFilling` PrometheusRule in `deploy/chart/templates/monitoring.yaml` for both `utopia` and `lore-db` PVCs.
- [ ] Add a panel for volume usage to `deploy/chart/files/dashboards/lore-services.json` (or a dedicated DB dashboard).

## Out of scope

- Routing the alerts to Alertmanager (Alertmanager is intentionally off, alerts show in Grafana/Prometheus UI).
