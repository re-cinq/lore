# Managing secrets

Three different operations, and only one of them touches Terraform:

| I want to... | Where | Terraform? |
|---|---|---|
| [Change a secret's value](#rotate-a-secret) | `gcloud secrets versions add` | no |
| [Add a new secret](#add-a-new-secret) | four files, one PR | yes |
| [Change a non-secret value](#change-a-non-secret-value) | `terraform.tfvars` | yes |

Lore's secret material lives in **GCP Secret Manager and nowhere else**.
Terraform declares the secret *containers* in
[`infra/terraform/secrets.tf`](../infra/terraform/secrets.tf) and resolves values
by *name*; External Secrets Operator mirrors them into Kubernetes. No secret
value is ever a Terraform input, so no laptop is authoritative about a
credential.

## Why it works this way

Terraform used to write `google_secret_manager_secret_version` from `var.*` —
that is, from whichever developer's gitignored `secrets.tfvars` happened to run
the apply. That gave every developer a private, silently-divergent copy of the
source of truth:

> Alice rotates a key in her tfvars and applies. Bob applies two days later from
> his own tfvars, which never saw the rotation, and Terraform pushes the **old**
> value back up as a new version. ESO syncs it. Pods restart. Everything 401s.

Nobody typed a wrong secret. The tool did it for them. Moving values out of
Terraform removes the second source of truth, which removes the failure.

## Rotate a secret

1. **Add the new version.** This is the whole rotation as far as storage goes:

   ```bash
   printf '%s' "$NEW_VALUE" \
     | gcloud secrets versions add lore-anthropic-api-key --data-file=-
   ```

   Use a file (`--data-file=key.pem`) for multi-line material like the GitHub App
   private key. Never pass a secret on the command line — it lands in shell
   history and in the process table.

2. **Get it into the pods.** ESO refreshes hourly, but a process that read an env
   var at boot keeps the old value until it restarts. The restart set for a
   secret change is:

   | Change | Restart |
   |---|---|
   | Anthropic key | `lore-floor`, `lore-api`, `lore-stations` |
   | DB password | `lore-floor`, `lore-api`, `lore-ui` |
   | Ingest / internal token | `lore-floor`, `lore-api`, `lore-ui` |
   | Slack credentials | `lore-floor`, `lore-api` |
   | OAuth / NextAuth | `lore-ui` |
   | GitHub App | `lore-floor`, `lore-api` |
   | GHCR pull secret | none — read at image-pull time |

   The ai-agents controller needs no restart; agent pods re-read `agent-secrets`
   when they spawn.

   ```bash
   kubectl rollout restart deployment -n lore-floor
   ```

3. **Re-sign anything that holds the other half.** A shared secret is two-sided.
   `lore-webhook-secret` must be updated on all repo webhooks in the same
   window, or GitHub signs with the old value and every delivery 401s.

4. **Verify, then revoke.**

   ```bash
   ./scripts/infra/check-secrets.sh
   ```

   Only once that is green should you disable the old version
   (`gcloud secrets versions disable`) and revoke the credential at the provider.
   A new GSM version is not a revocation — the old key still works until you go
   turn it off.

## Add a new secret

Adding a *value* needs no PR. Adding a *name* does, because four places have to
learn it exists.

1. **`infra/terraform/secrets.tf`** — add the name to `local.secret_names`. This
   creates the empty container. If the secret is optional, gate it with an
   `enable_*` bool (see `enable_anthropic_admin_key`) rather than a "is this
   variable non-empty" check — those checks are why a live credential used to
   sit in tfvars just to answer a yes/no question.
2. **`infra/terraform/external-secrets.tf`** — add a `kubectl_manifest`
   ExternalSecret so ESO mirrors it into the namespace that needs it. Copy
   `es_agent_internal_token` and change the five strings: the resource name, the
   `metadata.name`/`target.name`, the `namespace`, the `secretKey` (the key under
   which the value lands in the Kubernetes Secret — must match the chart's
   `secretKeyRef.key`), and the `remoteRef.key`. One
   ExternalSecret per namespace — Kubernetes Secrets do not cross namespaces.
3. **`scripts/infra/seed-secrets.sh`** — add it to `REQUIRED`, or to `OPTIONAL`
   if a gate controls it, so a fresh environment gets prompted for it instead of
   discovering it missing at runtime.
4. **The chart** — the `secretKeyRef` in whichever service reads it.

Then, in this order:

```bash
terraform apply                    # container + ExternalSecret now exist
./scripts/infra/seed-secrets.sh    # prompts only for the new empty one
# ...and only now merge the chart change
```

**The order is not a style preference.** CI deploys charts with `helm upgrade`,
but ExternalSecrets are created by `terraform apply`, and CI never runs
terraform. Merge a `secretKeyRef` before its ExternalSecret exists and the new
pod hits `CreateContainerConfigError` while `helm --wait` hangs to its timeout.
Old pods keep serving, so there is no outage — but the rollout cannot finish, and
the failure names a missing Secret rather than the missing apply that caused it.

If you cannot apply terraform right then, `kubectl apply` the ExternalSecret
manifest directly to unblock; ESO syncs instantly and the next `terraform apply`
adopts it.

## Change a non-secret value

Hostnames, `project_id`, the `enable_*` gates, `log_retention_days` — these live
in `infra/terraform/terraform.tfvars`, which Terraform auto-loads. Edit and
`terraform apply`. Nothing is secret in that file by design, so a team can commit
it and stop passing config around out of band.

## The failure `check-secrets.sh` exists to catch

A rotation can leave GSM on v3 while every running pod still holds v1. Nothing is
red: the pod and its peer agree, because they are both wrong in the same way. The
next unrelated restart — a node drain, a deploy, an autoscaler eviction — flips
one side and the fleet starts refusing itself. `check-secrets.sh` compares each
secret's newest enabled version against the start time of every pod that
consumes it, and fails when a pod predates the version it is supposed to be
holding.

## Seed a new environment

```bash
cd infra/terraform && terraform apply    # creates the empty containers
./scripts/infra/seed-secrets.sh          # prompts for each missing value
```

Idempotent: a secret that already has an enabled version is skipped, so
re-running it is free.

## Migrating an existing deployment

One time only, when moving a deployment off the old tfvars-driven scheme. The
secret *values* in GCP are not touched — only Terraform's claim to own them.

```bash
cd infra/terraform

# 1. Terraform forgets the versions. GCP keeps them.
#
# Read the addresses into an array rather than piping to xargs: the map-keyed
# ones look like `...lore["lore-db-password"]`, xargs does its own quote
# processing and strips them, and terraform then rejects the bare index with
# "Index value required". The unindexed addresses survive, so it half-runs. The
# array is also one atomic state write instead of one per address.
#
# The pattern is anchored so it cannot match data.google_secret_manager_secret_version
# — the db_password data source is a READ and belongs in state.
addrs=()
while IFS= read -r a; do addrs+=("$a"); done \
  < <(terraform state list | grep '^google_secret_manager_secret_version')
[[ ${#addrs[@]} -eq 0 ]] && echo '# nothing to remove' || terraform state rm "${addrs[@]}"

# 2. Confirm nothing is left, then the gate: the plan MUST be empty.
#    If it is not, read it — do not apply.
terraform state list | grep '^google_secret_manager_secret_version' || true  # expect nothing (exit 1 = clean)
terraform plan
```

Then rename your local `secrets.tfvars` to `terraform.tfvars` and delete every
secret variable from it; what remains is identifiers and hostnames. Set the three
`enable_*` gates to match what you had (`enable_anthropic_admin_key`,
`enable_cluster_agent_registration`, `enable_ui_admin_token`) — these replaced
the old "is this variable non-empty" checks.

**Land the whole change before anyone applies.** In the window between step 1 and
the merge, a stale checkout running the old code will rewrite the versions from
its own tfvars — the exact failure being removed here.
