# Rotating secrets

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
terraform state list \
  | grep google_secret_manager_secret_version \
  | xargs -n1 terraform state rm

# 2. The gate: this MUST be empty. If it is not, read it — do not apply.
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
