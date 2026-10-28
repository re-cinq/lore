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
   | Anthropic key | `lore-api`, `lore-stations` |
   | DB password | `lore-api`, `lore-ui`, `lore-stations` |
   | Ingest / internal token | `lore-api`, `lore-stations` |
   | Slack credentials | `lore-api`, `lore-stations` |
   | GitHub OAuth app (UI sign-in) | `lore-api` |
   | GitHub App | `lore-api`, `lore-ui`, `lore-stations` |
   | Utopia write token | `lore-api` |
   | GHCR pull secret | none — read at image-pull time |


   ```bash
   kubectl rollout restart deployment -n lore-api
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

## The Gemini credential (`lore-gemini-api-key`)

Gemini-model agent runs authenticate with a Generative Language API key the
run pod reads as `GEMINI_API_KEY`. Everything is gated on `enable_gemini` in
`terraform.tfvars` — the GSM container, the `agent-secrets` entry, and the
`gemini` model family in the central catalog render — so a deployment without
the key refuses gemini recipes cleanly (the reason shows on the /agents
Rollout column) instead of starting pods that cannot call their model.

Create the key IN the GCP project, so usage bills to the project and the key
can be restricted to the one API it is for:

```bash
gcloud services enable generativelanguage.googleapis.com apikeys.googleapis.com
gcloud services api-keys create --display-name="lore-gemini" \
  --api-target=service=generativelanguage.googleapis.com
KEY_NAME=$(gcloud services api-keys list --filter='displayName:lore-gemini' \
  --format='value(name)')
gcloud services api-keys get-key-string "$KEY_NAME" \
  --format='value(keyString)' | tr -d '\n' \
  | gcloud secrets versions add lore-gemini-api-key --data-file=-
```

Order: `terraform apply` first (it creates the GSM container the last command
writes into), seed the version, then confirm with `check-secrets.sh`. With the
key live, re-save each gemini-model definition on `/agents` — a refusal is
acked past permanently, so the re-save is what emits the catalog event that
makes the sync loop re-render and apply it.

## The Headlamp sign-in credentials (`lore-headlamp-*`)

The Headlamp dashboard (`infra/terraform/headlamp.tf`) is public at
`headlamp_hostname` and is gated by oauth2-proxy using Google as the identity
provider, restricted to `@re-cinq.com` addresses. Three secrets, all gated on
`enable_headlamp`, which Terraform refuses to accept without a non-empty
`headlamp_hostname` — oauth2-proxy derives its OAuth redirect URL from that
hostname and will not start without one.

Google OAuth **web** clients have no Terraform resource outside IAP, so the client
itself is created by hand, once:

1. Cloud Console → APIs & Services → **Credentials** → Create OAuth client ID →
   *Web application*, name `headlamp`.
2. Authorized redirect URI — exactly, or sign-in fails with `redirect_uri_mismatch`:
   `https://<headlamp_hostname>/oauth2/callback`
3. Consent screen: choose **Internal** if `re-cinq.com` is a Google Workspace org in
   this GCP org. That restricts sign-in to re-cinq accounts at Google's end as well
   as at oauth2-proxy's, which is the difference between one gate and two.

Then seed the versions:

```bash
printf '%s' "<client id>"     | gcloud secrets versions add lore-headlamp-oauth-client-id     --data-file=-
printf '%s' "<client secret>" | gcloud secrets versions add lore-headlamp-oauth-client-secret --data-file=-
openssl rand -base64 32 | head -c 32 \
  | gcloud secrets versions add lore-headlamp-cookie-secret --data-file=-
```

`head -c 32` is load-bearing: oauth2-proxy accepts a cookie secret of exactly 16,
24 or 32 bytes and refuses to start otherwise.

## The Grafana sign-in credentials (`lore-grafana-*`)

The metrics stack (`infra/terraform/monitoring.tf`, `enable_monitoring`) puts its own
oauth2-proxy in front of Grafana at `grafana_hostname`, with its OWN Google OAuth web
client: a redirect URI or a rotation on one dashboard then never touches the other.
Same recipe as Headlamp's, three containers behind `enable_monitoring`:

1. Cloud Console → APIs & Services → **Credentials** → Create OAuth client ID →
   *Web application*, name `grafana`.
2. Authorized redirect URI, exactly: `https://<grafana_hostname>/oauth2/callback`
3. Consent screen: the same **Internal** screen Headlamp uses.

```bash
printf '%s' "<client id>"     | gcloud secrets versions add lore-grafana-oauth-client-id     --data-file=-
printf '%s' "<client secret>" | gcloud secrets versions add lore-grafana-oauth-client-secret --data-file=-
openssl rand -base64 32 | head -c 32 \
  | gcloud secrets versions add lore-grafana-cookie-secret --data-file=-
```

Then `kubectl -n monitoring annotate externalsecret grafana-oauth force-sync=$(date +%s)`
and `kubectl -n monitoring rollout restart deploy/grafana-oauth2-proxy`, since the proxy
reads the secret as environment at start. First install order is Headlamp's too:
containers first, seed, then the rest.

**Order matters here, more than for the other secrets.** The Helm provider waits
for a release to become Ready, and oauth2-proxy cannot start without its secret, so
a single `terraform apply` on a fresh install fails on that release's 5-minute
timeout. Create the containers first, seed them, then apply the rest:

```bash
cd infra/terraform
terraform apply -target='google_secret_manager_secret.lore'   # containers only
# ... seed the three versions with the commands above ...
terraform apply                                              # the workloads
```

Rotating later is the ordinary path — `gcloud secrets versions add`, then
`kubectl rollout restart deploy/oauth2-proxy -n headlamp`. Rotating the cookie
secret signs everyone out; rotating the client secret needs the same restart.

**What these credentials protect.** GKE does not let you point the API server at a
third-party OIDC issuer, so a Google login cannot become a Kubernetes identity —
Headlamp talks to the API server as its own ServiceAccount, and everyone who gets
past Google shares that one identity. These secrets are therefore the *only* thing
deciding who reads the cluster, and the `headlamp-view` ClusterRole (read-only, no
Secrets) is the only thing bounding what they can read. Treat a leak of the client
secret as cluster-wide read exposure, and note that the Kubernetes audit log will
name the ServiceAccount rather than the person.

## The Utopia credentials (`lore-utopia-*`)

Utopia (`infra/terraform/utopia.tf`, `enable_utopia`) is the deeplethe/utopia
knowledge-graph app behind its own oauth2-proxy at `utopia_hostname`. Its OIDC
cannot create accounts, so Google is the gate and Utopia keeps its own accounts
inside it: the first person to register becomes the administrator. Six
containers behind `enable_utopia`.

The Google client is the Grafana recipe with the name `utopia` and the redirect
URI `https://<utopia_hostname>/oauth2/callback`, on the same **Internal** consent
screen. Then:

```bash
printf '%s' "<client id>"     | gcloud secrets versions add lore-utopia-oauth-client-id     --data-file=-
printf '%s' "<client secret>" | gcloud secrets versions add lore-utopia-oauth-client-secret --data-file=-
openssl rand -base64 32 | head -c 32 \
  | gcloud secrets versions add lore-utopia-cookie-secret --data-file=-
# hex, so they need no URL-encoding inside the database URLs: the owner's password,
# then the password of utopia_app, the restricted role the app runs as
openssl rand -hex 24 | tr -d '\n' | gcloud secrets versions add lore-utopia-db-password --data-file=-
openssl rand -hex 24 | tr -d '\n' | gcloud secrets versions add lore-utopia-app-db-password --data-file=-
# exactly 32 bytes as 64 hex digits: the key Utopia seals stored model credentials with
openssl rand -hex 32 | tr -d '\n' | gcloud secrets versions add lore-utopia-secret-key --data-file=-
```

**The sealing key is seeded on purpose.** Left unset, Utopia generates it into
`secret.key` on its data disk on first start, and a lost disk then loses every
model key and source credential stored since. Seeded, the disk holds only files
and the search index. Never rotate it: the rows it sealed become unreadable.

**The runtime role on a database that predates it.** The app connects as
`utopia_app` and migrates as the owner. On a fresh install the role is created at
bootstrap and upstream's migration 0010 grants it the tables. On a database that was
already migrated when the role arrived, the grants never ran, and the app would fail
on its first query. So create the role and grant it **before** the apply that brings
the block in; the operator then only sets its password (CNPG `managed.roles`) and the
app restarts straight onto a working role:

```bash
kubectl -n utopia exec -it utopia-db-1 -- psql -U postgres -d utopia <<'SQL'
CREATE ROLE utopia_app LOGIN;
GRANT CONNECT ON DATABASE utopia TO utopia_app;
GRANT USAGE ON SCHEMA public TO utopia_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO utopia_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO utopia_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO utopia_app;
REVOKE UPDATE, DELETE, TRUNCATE ON audit_events FROM utopia_app;
ALTER DEFAULT PRIVILEGES FOR ROLE utopia IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO utopia_app;
ALTER DEFAULT PRIVILEGES FOR ROLE utopia IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO utopia_app;
ALTER DEFAULT PRIVILEGES FOR ROLE utopia IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO utopia_app;
SQL
```

Rotating `lore-utopia-app-db-password` is ESO's `force-sync` annotation on
`utopia-app-db-credentials`, which the operator then writes into the role, and a
restart of `deploy/utopia`.

The database password is read by Terraform into the CNPG credentials Secret, as
`lore-db-password` is, so a rotation needs `terraform apply`, then a restart of
`deploy/utopia` in the `utopia` namespace; the OAuth trio needs the same
`force-sync` annotation and `rollout restart deploy/utopia-oauth2-proxy` as Grafana's.
First install order is Headlamp's too: containers first, seed, then the rest.

### The Utopia source key (`lore.utopia_sources`)

The key lore-api pushes a repo's spec/ADR chain with (ADR-052) is not a Secret
Manager secret. It lives in `lore.utopia_sources` (migration 0109), one row per
repo, which only the `lore` role can read and no route ever answers; the repo's
settings hold only the knowledge base and source ids, since the repo read routes
serve settings whole. It is a per-source key: it can push to that one source of
that one knowledge base and read nothing. Utopia hands it out once, when the
source is created.

To rotate it: in Utopia, `rotate-token` on the source (or delete the source), so
the old key stops working, then re-run `POST /api/repos/<o>/<r>/utopia/setup`
with a session token and the workspace id. Setup keeps a source whose key the
table still holds, so clear the row first, as `lore`:

```sql
DELETE FROM lore.utopia_sources WHERE lower(repo) = lower('<o>/<r>');
```

Setup then creates a fresh `lore` source, overwrites the row with its key and
points the settings at it.

### The lore-reviewer App (`lore-reviewer-app-*`)

The auto-merge loop approves a green, reviewed pull request as a second GitHub App,
**lore-reviewer**, whose only job is to approve: GitHub refuses an approval from the
account that opened a pull request, and Lore's own App opens the implementation
loop's, onboarding's and spec upkeep's. Without it the loop still approves
people's pull requests as Lore's App, and parks Lore's own with "needs the
lore-reviewer App" (specs/protected-branch-merge).

To create it, an org owner opens **GitHub → Organization settings → Developer
settings → GitHub Apps → New GitHub App**, named `lore-reviewer`, with no webhook,
and these repository permissions: Pull requests **read and write**, Contents
**read**, Checks **read**, Metadata **read**. Install it on the organization's
repositories, generate a private key, and note the App id and the installation
id (the number at the end of the installation's settings URL).

Terraform creates the three secret containers only once the flag is on, so turn
it on first: set `enable_lore_reviewer = true` in `terraform.tfvars` and
`terraform apply` from main. That creates the containers and the ExternalSecret.
Then add the values:

```bash
printf '%s' "<app id>" | gcloud secrets versions add lore-reviewer-app-id --data-file=-
gcloud secrets versions add lore-reviewer-app-private-key --data-file=lore-reviewer.private-key.pem
printf '%s' "<installation id>" | gcloud secrets versions add lore-reviewer-app-installation-id --data-file=-
```

ESO mirrors the three into the `lore-reviewer-app` Secret in `lore-stations`,
read as `LORE_REVIEWER_APP_ID`, `LORE_REVIEWER_APP_PRIVATE_KEY` and
`LORE_REVIEWER_APP_INSTALLATION_ID`. The references are `optional`, so the
stations pod starts before the values exist; once they do, sync and restart:

```bash
kubectl -n lore-stations annotate externalsecret lore-reviewer-app force-sync="$(date +%s)" --overwrite
kubectl -n lore-stations rollout restart deploy/lore-stations
```

### The Utopia write token (`lore-utopia-lore-api-token`)

With it, lore-api sets a repo's knowledge base up on the repo's first spec or ADR
ingest instead of waiting for someone to run the setup route (ADR-052 amendment
2026-10-15). It is a Utopia **personal access token with `write` scope**
(`utp_pat_…`) of a Utopia person kept for Lore, the "Lore" service person, who is
**workspace admin** of the workspace Lore's knowledge bases live in. Utopia
accepts it on the setup routes only from deeplethe/utopia#1244 on; until that
release is deployed, leave `enable_utopia_auto_setup` off. The token acts as that
person and can never do more than they can, and every base it creates is in
Utopia's audit log under their name.

Behind `enable_utopia_auto_setup`, which also sets `UTOPIA_WORKSPACE_ID` from
`utopia_lore_workspace_id`. ESO mirrors it into the `utopia-token` Secret in
`lore-api` (key `token`), read as `UTOPIA_TOKEN`. The reference is `optional`,
so unlike the other secrets this one can be seeded after the apply that turns
the flag on: until it is, lore-api starts without `UTOPIA_TOKEN` and sets no repo
up by itself, and the restart below picks it up.

To mint it: sign in to Utopia as the Lore person, open **Account → Agents &
tokens → Personal access tokens**, and issue a token with scope `write`, no
knowledge-base limit (a limited token can create no base) and the longest expiry
you will rotate within (90 days by default). The value is shown once:

```bash
printf '%s' "utp_pat_…" \
  | gcloud secrets versions add lore-utopia-lore-api-token --data-file=-
kubectl -n lore-api annotate externalsecret utopia-token force-sync="$(date +%s)" --overwrite
kubectl -n lore-api rollout restart deploy/lore-api
```

The workspace id is in the Utopia URL of the workspace (`/workspaces/<id>`); put
it in `terraform.tfvars` as `utopia_lore_workspace_id`.

To rotate: issue a new token the same way, add it as a new version, force-sync,
restart lore-api, then revoke the old token in the same Utopia page. A token that
expired or was revoked makes every setup fail with a 401; that is a failed
mirror, logged and counted on `lore_utopia_mirror_failures_total`, never a failed
ingest. Repos already set up keep pushing: they push with their own source key,
not with this token.

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

The containers have to exist before a value can be written to them, and the
workloads have to come after both — the Helm provider waits for Ready, and a pod
whose `secretKeyRef` points at an unseeded secret never gets there. So the first
apply is targeted:

```bash
cd infra/terraform
terraform apply -target='google_secret_manager_secret.lore'  # the empty containers
./scripts/infra/seed-secrets.sh                              # prompts for each missing value
terraform apply                                              # the workloads
```

Idempotent: a secret that already has an enabled version is skipped, so
re-running it is free. On an environment that is already up, the plain
`terraform apply` is enough on its own — the targeted first pass is only for a
cold start, or for a newly added secret whose consumer ships in the same apply.

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
secret variable from it; what remains is identifiers and hostnames. Set the two
`enable_*` gates to match what you had (`enable_anthropic_admin_key`,
`enable_ui_admin_token`) — these replaced the old "is this variable non-empty"
checks.

**Land the whole change before anyone applies.** In the window between step 1 and
the merge, a stale checkout running the old code will rewrite the versions from
its own tfvars — the exact failure being removed here.
