# Runbook: Floor → ai-agent-subsystem cutover on GKE (production)

When to use this runbook: you're ready to run the ADR-031 cutover on the **real GKE
cluster** (not the local minikube smoke in `floor-graph-minikube-smoke.md`). This is the
production path: the subsystem deploys via `terraform apply`, secrets come from External
Secrets Operator (ESO) pulling GCP Secret Manager, and the Floor runs in-cluster. Every
step before the teardown is **reversible** — the cutover is gated OFF by default, so
applying the deploy changes nothing until you flip an env var.

Plain-language note: on GKE you don't `helm install` or `kubectl create secret` by hand
(that was minikube). Terraform owns the deploy and ESO syncs the secrets. Your levers are
`terraform apply` (deploy) and a couple of settings/env values (the flip).

Severity of the irreversible step (teardown): treat the `loretask-crd` removal as a P2
change — do it only after a soak with green metrics.

## 0. Prerequisites

```bash
gcloud container clusters get-credentials <CLUSTER> --region <REGION> --project <PROJECT>
kubectl config current-context   # confirm you're on the GKE cluster, NOT minikube
cd infra/terraform                # terraform + secrets.tfvars already configured
```

The subsystem is already wired in terraform (`infra/terraform/ai-agents.tf`): the
`ai-agents` namespace, two `ExternalSecret`s (`agent-secrets` + the GHCR pull secret,
mirrored from the **same** Secret Manager refs the Floor uses — no new secret material),
and the `helm_release.ai_agents` (CRDs + controller + seeded catalog + RBAC + NetworkPolicy).

## 1. Pin the v0.3.0 images (paired)

The chart pins the **controller** to v0.3.0 already. The **agent runtime** image ships as a
pair from the same v-tag matrix — resolve + pin it too (it's a non-public package, so this
needs your ghcr read):

```bash
skopeo inspect --no-tags docker://ghcr.io/re-cinq/ai-agent:v0.3.0 \
  | grep -oE 'sha256:[a-f0-9]{64}' | head -1
# put it in modules/gke-mcp/ai-agents-helm/values.yaml → controller.agentImage
```

## 2. Deploy the subsystem (reversible)

```bash
terraform apply -var-file=secrets.tfvars   # + the lore_api_url/lore_ui_url/... vars
```

This creates the namespace, ESO secrets, CRDs, controller, the seeded catalog
(`AgentDefinition`/`Station` per task type), and all RBAC. **It does not route any task
yet** — the cutover gate is still off.

## 3. Verify the deploy

```bash
kubectl -n ai-agents get pods                         # controller 2/2 Running
kubectl -n ai-agents get externalsecrets              # agent-secrets + ghcr SecretSynced=True
kubectl -n ai-agents get agentdefinitions,stations    # the seeded catalog, one per task type
kubectl -n ai-agents get networkpolicy                # egress lock-down present
kubectl -n ai-agents get rolebindings                 # lore-floor-* + lore-mcp-catalog-writer
```

If `agentdefinitions` is empty, the catalog didn't seed — check `seedCatalog: true` and the
chart's `templates/catalog.yaml` render.

## 4. (optional, #687) Wire the telemetry sink auth

So run pods can POST to the Floor's `/api/agent-events`, add the bearer header key the
recipes reference (`agent-events-auth`) into `agent-secrets`, and allow egress
`ai-agents → lore-floor` in the NetworkPolicy. Skip if you don't need cost rows on day one.

## 5. Pilot flip (reversible)

Turn the **cluster gate** on for the Floor, opt **one** repo in, keep the ramp at 0% first
to confirm nothing routes, then a small slice:

```bash
# Cluster gate — set on the Floor deployment (floor-helm values / its terraform), then apply:
#   env LORE_AGENT_CR_BACKEND_ENABLED = "true"   (use --set-string; avoid YAML bool coercion)
#   env LORE_AGENT_CR_BACKEND_PERCENT = "0"  → then "10"
# Per-repo opt-in (settings UI, or SQL):
psql "$LORE_DB_URL" -c "
  UPDATE lore.repos
     SET settings = jsonb_set(settings, '{dark_factory,execution,backend}', '\"agent-cr\"', true)
   WHERE full_name = '<pilot-org/repo>';"
```

Both gates must be on for `agent-cr`; the `%` (a stable hash of the task id) then ramps it.

## 6. Verify the round-trip on GKE

Kick a task on the pilot repo (UI / MCP / Slack). A task type **with a workflow**
(implementation, general, gap-fill) runs the **graph** — one Agent CR per node; one
**without** (onboard, review, runbook) runs a **single** Agent.

```bash
kubectl -n ai-agents get agents -w                    # CR(s) appear; graph → <id8>-<nodeId>
kubectl -n ai-agents get jobs,pods                    # a Job pod per Agent
git -C <clone> log --format='%s%n%b' origin/<branch> | grep Lore-Stage   # branch-as-state
psql "$LORE_DB_URL" -c "SELECT model, cost_usd FROM pipeline.llm_calls
                          WHERE task_id = '<task>' ORDER BY created_at DESC LIMIT 5;"
```

Checklist mirrors `floor-graph-minikube-smoke.md` §Verification.

## 7. Ramp

Raise `LORE_AGENT_CR_BACKEND_PERCENT` (10 → 25 → 50 → 100) across deploys, watching the
auto-merge / failure / cost metrics between steps. Opt more repos in as confidence grows.

## 8. Teardown — **irreversible**, after a soak

Only once `agent-cr` carries the load with green metrics. Both controllers can run in
parallel indefinitely, so there's no rush.

```bash
# Remove the loretask-crd module from terraform (delete the module block / target), then:
terraform plan -var-file=secrets.tfvars    # confirm ONLY loretask-crd + claude-runner go
terraform apply -var-file=secrets.tfvars
```

This destroys the `loretask-crd` controller, the `claude-runner` image plumbing, and the
cluster-wide `loretask-agent` RBAC. Also retire the #698 Postgres dual-write once `agent-cr`
is the org default. **Do this deliberately — it cannot be rolled back with a flag.**

## Rollback (any time before §8)

```bash
# Flip the gate off (every task reverts to LoreTask on the next dispatch):
#   env LORE_AGENT_CR_BACKEND_ENABLED = "false"   on the Floor, apply.
# Or per-repo: set settings.dark_factory.execution.backend back to "loretask" (or remove it).
```

The legacy path is untouched until §8, so this fully reverts behavior.

## See also

- `runbooks/floor-graph-minikube-smoke.md` — local verification before touching prod.
- `runbooks/dark-factory-rollback.md` — disabling auto-merge across repos.
- ADR-031, `specs/floor-on-ai-subsystem/`.
