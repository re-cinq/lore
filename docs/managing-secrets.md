# Managing secrets

Lore's secret material lives in GCP Secret Manager in project `re-cinq-internal`
and nowhere else. The containers are declared in re-cinq/infrastructure
(`projects/internal/secrets.tf`); a person adds the values with `gcloud`; the
umbrella chart's `platform.externalSecrets` list in
[`deploy/clusters/internal-cluster.values.yaml`](../deploy/clusters/internal-cluster.values.yaml)
maps them into Kubernetes Secrets through `ClusterSecretStore/gcp-secret-manager`.
Argo CD applies the chart on every merge to `main`. Run every `gcloud` command
below with `--project re-cinq-internal`.

| I want to... | Where |
|---|---|
| [Change a secret's value](#rotate-a-secret) | `gcloud secrets versions add` |
| [Add a new secret](#add-a-new-secret) | re-cinq/infrastructure, then a value, then the values file |
| [Change a non-secret value](#change-a-non-secret-value) | the values file |

## Rotate a secret

1. **Add the new version.** This is the whole rotation as far as storage goes:

   ```bash
   printf '%s' "$NEW_VALUE" \
     | gcloud secrets versions add lore-anthropic-api-key --project re-cinq-internal --data-file=-
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

1. **The container.** Add its name to `projects/internal/secrets.tf` in
   re-cinq/infrastructure and get that merged and applied.
2. **The value.**

   ```bash
   printf '%s' "$VALUE" \
     | gcloud secrets versions add <name> --project re-cinq-internal --data-file=-
   ```

3. **The mapping.** Add an entry under `platform.externalSecrets` in the values
   file: the Kubernetes Secret `name`, its `namespace`, and `keys`, which maps
   each key in the Secret to a Secret Manager name. One entry per namespace —
   Kubernetes Secrets do not cross namespaces. Then the `secretKeyRef` in the
   service that reads it, in the same PR.

Do them in that order. A `secretKeyRef` whose Secret does not exist yet leaves
the new pod in `CreateContainerConfigError`; old pods keep serving, but the
rollout cannot finish. A reference marked `optional` can go first.

## Change a non-secret value

Hostnames, feature switches, environment variables, resources: edit
`deploy/clusters/internal-cluster.values.yaml` and merge. Argo CD syncs it.
Nothing in that file is secret.

## The Gemini credential (`lore-gemini-api-key`)

Gemini-model agent runs authenticate with a Generative Language API key the
run pod reads as `GEMINI_API_KEY`. The values file maps it into the floor's
`agent-secrets` Secret (the `floor-agent-secrets-lore-mcp` entry). A deployment
without the key refuses gemini recipes cleanly (the reason shows on the /agents
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

Then confirm with `check-secrets.sh`. With the
key live, re-save each gemini-model definition on `/agents` — a refusal is
acked past permanently, so the re-save is what emits the catalog event that
makes the sync loop re-render and apply it.

## The lore-reviewer App (`lore-reviewer-app-*`)

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

The three containers are in re-cinq/infrastructure and the `lore-reviewer-app`
entry is in the values file. Add the values:

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

## The Utopia write token (`lore-utopia-lore-api-token`)

With it, lore-api sets a repo's knowledge base up on the repo's first spec or ADR
ingest instead of waiting for someone to run the setup route (ADR-052 amendment
2026-10-15). It is a Utopia **personal access token with `write` scope**
(`utp_pat_…`) of a Utopia person kept for Lore, the "Lore" service person, who is
**workspace admin** of the workspace Lore's knowledge bases live in. Utopia
accepts it on the setup routes only from deeplethe/utopia#1244 on; until that
release is deployed, leave `UTOPIA_WORKSPACE_ID` unset. The token acts as that
person and can never do more than they can, and every base it creates is in
Utopia's audit log under their name.

ESO mirrors it into the `utopia-token` Secret in `lore-api` (key `token`), read
as `UTOPIA_TOKEN`. The reference is `optional`, so it can be seeded after the
chart change: until it is, lore-api starts without `UTOPIA_TOKEN` and sets no
repo up by itself, and the restart below picks it up.

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

The workspace id is in the Utopia URL of the workspace (`/workspaces/<id>`); set
it as `UTOPIA_WORKSPACE_ID` in lore-api's `env` in the values file.

To rotate: issue a new token the same way, add it as a new version, force-sync,
restart lore-api, then revoke the old token in the same Utopia page. A token that
expired or was revoked makes every setup fail with a 401; that is a failed
mirror, logged and counted on `lore_utopia_mirror_failures_total`, never a failed
ingest. Repos already set up keep pushing: they push with their own source key,
not with this token.

## The Utopia source key (`lore.utopia_sources`)

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

## Dashboards and Utopia

The Headlamp and Grafana sign-in credentials belong to the cluster baseline in
re-cinq/infrastructure, and Utopia's to its own chart in re-cinq/utopia; their
recipes live there.

## The failure `check-secrets.sh` exists to catch

A rotation can leave GSM on v3 while every running pod still holds v1. Nothing is
red: the pod and its peer agree, because they are both wrong in the same way. The
next unrelated restart — a node drain, a deploy, an autoscaler eviction — flips
one side and the fleet starts refusing itself. `check-secrets.sh` compares each
secret's newest enabled version against the start time of every pod that
consumes it, and fails when a pod predates the version it is supposed to be
holding.
