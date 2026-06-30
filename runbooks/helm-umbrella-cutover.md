# Zero-downtime cutover to the `lore-platform` umbrella chart

Migrates the live cluster from the five separate Helm releases (`lore-floor`,
`lore-mcp`, `lore-ui`, `lore-db`, `ai-agents`) to the single `lore-platform`
umbrella release **without deleting any workload**.

## Why this is zero-downtime

The umbrella chart creates every object with the **same name and namespace** as
the old releases did (names pinned to `.Chart.Name`, namespaces stamped from
`.Values.namespace`). So the cutover only needs to **transfer Helm ownership**
of the already-running objects — not delete and recreate them.

The one rule that makes it seamless: the adopting `helm upgrade` must use the
**same values that produced the live objects** (so `spec.template` is byte-identical
→ Kubernetes does not roll the pods). We get those values straight from the live
releases with `helm get values -a`, so there is no hand-copying / drift.

> ⚠️ Do the adoption (steps 1–4) **before merging the PR**. CI's deploy jobs run a
> plain `helm upgrade --install lore-platform` (no `--take-ownership`); if `main`
> merges first, that deploy fails safely on an ownership conflict (no downtime,
> just a red run) until the adoption below has happened.

## Data safety — why zero data loss is guaranteed

This cutover **cannot lose data** because it never touches a stateful resource:

- **Postgres (CNPG)** — the `lore-db` Cluster CR and its 50Gi PVC are a
  Terraform `kubectl_manifest`, owned by the CloudNativePG operator, **not by any
  Helm release**. The umbrella's `lore-db-helm` subchart is *only* the
  ownership-reconciler hook Job (an idempotent `ALTER … OWNER`, no data writes).
- **Dgraph** — the StatefulSet + its 50Gi PVC are a Terraform `kubectl_manifest`,
  **not in the umbrella chart**. Never referenced by the cutover.
- The five app subcharts contain **no StatefulSets and no PVCs** — only stateless
  Deployments, Services, ConfigMaps, RBAC, etc. There is nothing with data to
  delete.
- No step runs `helm uninstall` on a data-bearing release. Step 3 deletes only
  Helm *bookkeeping secrets*. Terraform state ops (step 4) don't touch the cluster.
- DB migrations run by the ui hook are idempotent + skip-if-applied (tracked in
  `lore.schema_migrations`); the cutover does not re-apply or reverse any.

GCS buckets (task logs, DB backups), the CNPG `ScheduledBackup`, ESO secrets, and
the ingresses are all Terraform-owned and untouched.

Prereqs: `helm` ≥ 3.17 (for `--take-ownership`; the runner/your machine has 3.19),
`kubectl` + `yq`, cluster admin creds, and the feature branch checked out.

```bash
git checkout refactor/helm-umbrella-chart
CHART=infra/terraform/modules/gke-mcp/lore-platform
```

## 1. Snapshot live values (incl. the running image tags)

`-a` returns the fully-computed values, so the running image SHAs and all
terraform-set env are captured exactly as live.

```bash
helm get values lore-floor -n lore-floor  -a -o yaml > /tmp/floor.yaml
helm get values lore-mcp   -n mcp-servers -a -o yaml > /tmp/mcp.yaml
helm get values lore-ui    -n lore-ui     -a -o yaml > /tmp/ui.yaml
helm get values lore-db    -n lore-db     -a -o yaml > /tmp/db.yaml
helm get values ai-agents  -n ai-agents   -a -o yaml > /tmp/agents.yaml
```

Re-nest each under its subchart key and add the explicit `namespace`, producing
one umbrella values file:

```bash
{
  echo 'lore-floor:';   yq e '. * {"namespace":"lore-floor"}'  /tmp/floor.yaml  | sed 's/^/  /'
  echo 'lore-mcp:';     yq e '. * {"namespace":"mcp-servers"}' /tmp/mcp.yaml    | sed 's/^/  /'
  echo 'lore-ui:';      yq e '. * {"namespace":"lore-ui"}'     /tmp/ui.yaml     | sed 's/^/  /'
  echo 'lore-db-helm:'; yq e '. * {"namespace":"lore-db"}'     /tmp/db.yaml     | sed 's/^/  /'
  echo 'ai-agents:';    yq e '. * {"namespace":"ai-agents"}'   /tmp/agents.yaml | sed 's/^/  /'
} > /tmp/cutover-values.yaml
```

Sanity-check that the rendered specs match live BEFORE touching anything:

```bash
helm template lore-platform "$CHART" -f /tmp/cutover-values.yaml --include-crds \
  | kubectl diff -f - || true   # expect only metadata/ownership-annotation diffs, NOT spec.template
```

If a `spec.template` (image/env) diff shows up, stop and reconcile the values —
that diff is what would roll a pod.

## 2. Adopt the live objects into the new release (in place)

`--take-ownership` rewrites the Helm ownership annotations on the existing
objects to `lore-platform` and patches them in place. Same specs → no pod roll.
Pre-install hooks (ui migrate, db reconciler) run once; both are idempotent.

```bash
helm upgrade --install lore-platform "$CHART" \
  --namespace lore-floor \
  --take-ownership \
  -f /tmp/cutover-values.yaml
```

Verify nothing rolled (RESTARTS unchanged, all Ready):

```bash
kubectl get deploy -A -l app.kubernetes.io/managed-by=Helm
helm get metadata lore-platform -n lore-floor
```

## 3. Retire the 5 old release records (keep the objects)

Delete only the old release **secrets** — this removes them from `helm list`
without `helm uninstall` (which would delete the now-adopted objects).

```bash
kubectl delete secret -n lore-floor  -l owner=helm,name=lore-floor
kubectl delete secret -n mcp-servers -l owner=helm,name=lore-mcp
kubectl delete secret -n lore-ui     -l owner=helm,name=lore-ui
kubectl delete secret -n lore-db     -l owner=helm,name=lore-db
kubectl delete secret -n ai-agents   -l owner=helm,name=ai-agents
helm list -A   # should show only lore-platform (+ external-secrets, lore-db CNPG etc.)
```

## 4. Hand the release back to Terraform

Drop the old releases from state (no uninstall) and import the live one, so
`terraform apply` sees `lore_platform` as already-created.

```bash
cd infra/terraform
for r in lore_ui lore_mcp lore_agent ai_agents lore_db_extras; do
  terraform state rm "helm_release.$r" || true
done
terraform import helm_release.lore_platform lore-floor/lore-platform
terraform plan    # expect ~no changes (reuse_values keeps the live image tags)
terraform apply   # only if the plan is clean / metadata-only
```

## 5. Merge the PR

With the cluster already on `lore-platform`, merge `refactor/helm-umbrella-chart`.
Post-merge CI rebuilds the three images (the chart paths moved) and rolls them via
`helm upgrade lore-platform --set <svc>.image.tag=<sha> --reset-then-reuse-values`.
Multi-replica services (ui, mcp — both have PDBs) roll with no downtime; floor is a
singleton so it has a brief internal gap in task pickup (not user-facing).

## Rollback

Until step 3, rollback is trivial — the old release secrets still exist:

```bash
helm uninstall lore-platform -n lore-floor --keep-history   # or: kubectl delete secret -n lore-floor -l name=lore-platform
# the original releases still own nothing was deleted; re-run terraform apply on the OLD config to reconcile
```

After step 3, roll back by re-running the old `terraform apply` from the
pre-merge revision (recreates the 5 releases, adopting the same live objects).
No data is ever at risk: CNPG, Dgraph, ESO secrets, and the ingresses are never
touched by this cutover.
