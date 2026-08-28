---
adr_number: 46
title: "Secret values are not Terraform inputs"
status: accepted
date: 2026-08-27
deciders: ["Bogdan Szabo"]
domains: [infrastructure, security, terraform, operations]
---

# ADR-046: Secret values are not Terraform inputs

This ADR records why Terraform declares GCP Secret Manager containers but never their values, so that the next person to add a secret reaches for `gcloud secrets versions add` instead of adding a `sensitive = true` variable and re-creating the failure this removed.

## Context

[`specs/eso-gitops/spec.md`](../specs/eso-gitops/spec.md) consolidated Lore's scattered secret state into GCP Secret Manager fronted by External Secrets Operator, with Terraform as the GitOps tool. Its architecture placed both halves of a secret under Terraform:

```
├── google_secret_manager_secret         (11 secrets)
├── google_secret_manager_secret_version (values)
```

The values reached the second resource through `sensitive = true` variables fed by `infra/terraform/secrets.tfvars`, a file gitignored under `*.tfvars`. That satisfied the spec's fourth acceptance criterion — no secret values in Git — and it is the arrangement most Terraform tutorials show.

It also gave every developer a private, silently-divergent copy of the source of truth. Because `secrets.tfvars` was per-laptop and unshareable, no two copies stayed equal for long, and the apply that reconciled them always won:

> Alice rotates a key in her tfvars and applies. Bob applies two days later from his own tfvars, which never saw the rotation, and Terraform pushes the **old** value back up as a new version. ESO syncs it. Pods restart. Everything 401s.

Nobody typed a wrong secret. The tool did it for them, from a file that was doing exactly what it was configured to do. The team's felt experience was "we keep changing secrets and breaking the deployment," which reads as a discipline problem and is not one — no amount of care fixes a system with two authorities over the same fact.

Two related symptoms came from the same root. Reconciling the two copies needed a documented ritual that turned on *which side was newer*, and getting that judgement wrong once overwrote three freshly-rotated credentials with stale ones. And two secrets — the org-admin Anthropic key and the satellite registration token — were held in tfvars purely so a `!= ""` check could decide whether an ExternalSecret should exist, i.e. a live credential was being stored to answer a yes/no question.

## Decision

Decision: Terraform owns the existence of a secret and never its value — `google_secret_manager_secret` stays, `google_secret_manager_secret_version` is removed, and `infra/terraform/variables.tf` holds no secret-valued variable.

## Consequences

### Consequences for what Terraform declares

A secret's name is infrastructure — declarative, reviewable, something a plan should reconcile. A secret's value is not: it changes on a rotation schedule that has nothing to do with an infrastructure change, and it lives in exactly one place, Secret Manager itself.

Anything that must decide whether a secret-backed resource exists uses an explicit `enable_*` boolean, never the emptiness of a credential. Two secrets previously sat in tfvars purely so a `!= ""` check could answer that question.

### Consequences for the failure mode: it becomes structurally impossible

No apply from any checkout can write a secret value, so a stale copy has nothing to push. This is the whole point: the fix removes the second authority rather than adding a procedure for keeping two authorities in agreement.

### Consequences for rotation: it stops being a deploy

Adding a version and restarting the consumers is the entire operation:

```bash
printf '%s' "$NEW_VALUE" | gcloud secrets versions add lore-anthropic-api-key --data-file=-
kubectl rollout restart deployment -n lore-floor
```

No plan, no apply, no lock, no coordination with whoever else is mid-apply. The restart set per secret and the full procedure are in [`docs/managing-secrets.md`](../docs/managing-secrets.md).

### Consequences for plan noise: one read-back remains

`data.google_secret_manager_secret_version.db_password` reads the database password at plan time, because `lore-db.tf` renders it into the CNPG basic-auth Secret. A read cannot overwrite, so it does not reintroduce the problem. It does mean the value is unknown at plan time, so `kubectl_manifest.lore_db_credentials` shows as an in-place update on every plan while writing identical bytes — expected noise, not drift.

### Consequences for bootstrap: two applies

`lore-db` reads that password at plan time, so a fresh environment cannot resolve a full plan until the container exists and holds a value: `terraform apply -target=google_secret_manager_secret.lore`, then `scripts/infra/seed-secrets.sh`, then the full apply.

### Consequences for teardown: containers carry `prevent_destroy`

A container holds every historical version of a live credential, so losing one to a rename, a refactor, or a mistargeted apply is unrecoverable. This makes `terraform destroy` refuse, which invalidates the eso-gitops spec's seventh acceptance criterion; tearing the platform down now means `-target`ing around the secrets, or dropping the lifecycle block as a separate reviewed commit.

### Consequences for refactors: moving a secret between addresses needs a `moved` block

Terraform reads an address change as delete-and-create. Folding the GHCR secret into the map — same `secret_id`, different address — planned to destroy the container and every version of the pull token with it, then recreate it empty. `prevent_destroy` does not catch this: the lifecycle block sits on the new address while the destroy belongs to the old one, which is by then absent from config. Only reading `terraform show -json` on a saved plan caught it. **Any refactor that moves a secret resource must ship the `moved` block in the same change, and must be reviewed as a saved plan rather than a validate.**

### Consequences for adding a secret: four places, one ordering constraint

The container (`local.secret_names`), an ExternalSecret per consuming namespace, the seed script's list, and the chart's `secretKeyRef` — and the apply must land before the chart change merges, because CI helm-deploys but never runs Terraform.

### Consequences for verification: what replaces the guarantee Terraform gave

Terraform no longer proves a secret has a value, so two scripts do:
`scripts/infra/seed-secrets.sh --check` fails when a container has no enabled version, and `scripts/infra/check-secrets.sh` catches the rotation that never reached the pods — Secret Manager on v3 while every pod still holds v1, green because both sides are wrong in the same way, until an unrelated restart flips one and the fleet starts refusing itself.

## Alternatives considered

**Keep Terraform as the writer, add a reconcile ritual.** The existing practice: before applying, diff tfvars against Secret Manager and work out which side is newer. Rejected — it is a procedure for keeping two sources of truth in agreement, which is the problem restated as a chore. It had already failed once in exactly the way procedures fail, overwriting three freshly-rotated credentials with stale ones.

**Commit encrypted secrets (SOPS, sealed-secrets).** Restores a single shared source of truth and keeps values in Git. Rejected as a larger change than the problem needs: Secret Manager is already the runtime source of truth via ESO, already audits access, and already versions. Adding an encrypted-at-rest copy in Git would create a *second* store to keep in sync — the same shape as the failure, with better cryptography.

**`TF_VAR_*` from a shared password manager.** Keeps Terraform as writer while removing the per-laptop file. Rejected — the write path is what makes a stale value destructive; moving where the staleness comes from does not remove it.

## References & rationale

- [`specs/eso-gitops/spec.md`](../specs/eso-gitops/spec.md) — the spec this amends
- [`docs/managing-secrets.md`](../docs/managing-secrets.md) — the operational procedures
- [`infra/terraform/secrets.tf`](../infra/terraform/secrets.tf) — the containers, the `moved` block, and the reasoning inline
