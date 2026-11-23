# lore-install

One chart that installs Lore, the floor, the agent subsystem and, if you want it, Utopia.
Start from `values.minimal.example.yaml` (GitHub, one model key, hostnames, nothing else)
or the example for your cluster: `values.aks.example.yaml`, `values.gke.example.yaml`,
`values.local.example.yaml`. Only GitHub is mandatory.

## Namespace safety on upgrade

`lore-databases` creates `lore-floor` before Lore is installed. Use the existing
namespace when installing `lore-install`. With your own databases, create
`lore-floor` separately first if it is missing. Helm 4's `--create-namespace`
can remove the database release's metadata from an existing `lore-floor`.

If a database upgrade stops with a message about protecting `lore-floor`,
verify that the existing namespace is the intended one and is `Active`. Apply
the retention annotation to that namespace, then retry the database upgrade.
This protects it from pruning by a previous database release while preserving
its current ownership.

```bash
kubectl get namespace lore-floor
kubectl annotate namespace lore-floor helm.sh/resource-policy=keep --overwrite
```

Both releases apply `lore-floor` with server-side apply under the same field
manager, `helm`. When `--create-namespace` applies it again, Helm removes the
fields that apply leaves out: the database release's annotations and its
`helm.sh/resource-policy: keep`. Reproduced with Helm 4.3.1.

After the annotation, `lore-floor` is no longer part of the database release.
`helm uninstall lore-databases` then leaves the namespace and its
`floor-postgres` Secret in place, because both keep the retention policy. Delete
them yourself when you remove Lore.

If an earlier upgrade already deleted `lore-floor`, recover in this order:

1. If Utopia was enabled, its data and database volumes lived in `lore-floor`.
   Before you install anything, find what is left of them: released
   PersistentVolumes (`kubectl get pv`), disk snapshots or backups. Plan their
   restore first, because a new install provisions empty volumes.
2. Upgrade `lore-databases` with this version. It creates the namespace again
   and writes `floor-postgres` with the password kept in `lore-db`.
3. Restored Utopia data needs the keys and passwords it was written with. The
   chart generated `utopia-app` (`secret-key`), `utopia-db-credentials` and
   `utopia-app-db-credentials` in `lore-floor`, and a new install generates
   different ones. Take the originals from your backup or secret store and set
   them as `secrets.utopia.secretKey`, `secrets.utopia.dbPassword` and
   `secrets.utopia.appDbPassword`, or create those Secrets yourself. Without
   the original `secret-key`, the provider credentials stored in Utopia cannot
   be read and must be entered again.
4. Create again, in `lore-floor`, every Secret you supply yourself, such as
   `utopia-oauth` when the OIDC values are left empty. The install stops while
   a required one is missing.
5. Upgrade `lore-install`, which writes its Secrets from your values again.
6. Fill `agent-secrets` again. The floor creates it empty, so agents have no
   model credentials until you do. See
   [Give the agents their model key](../../docs/install/aks.md#5-give-the-agents-their-model-key)
   (AKS), or the same step of your cluster's guide.

## Secrets: your values, or your own Secret

For every group in `secrets:` of `values.yaml` you choose one way.

- Set the values, and this chart writes the Secret (labelled `lore-install.re-cinq.com/managed`).
- Leave them empty, and create the Secret yourself with the name, namespace and keys below
  (kubectl, a vault operator, anything). The chart never touches it.

A required Secret that is neither set nor present stops the install and names it. `helm
template` cannot read the cluster, so it skips that check and renders no Secret for an empty
group; `helm install --dry-run=server` checks it for real. Tokens are generated when empty and
kept on upgrade; a Secret of yours with a token is copied to the other namespaces that read it
only when that copy is absent.

| Secret | Namespace | Keys | Needed |
|---|---|---|---|
| `github-app-credentials` | `lore-api`, `lore-ui` | `app-id`, `private-key`, `installation-id`; in `lore-api` also `client-id`, `client-secret` (sign-in) | required |
| `lore-user-token-key` | `lore-api` | `key` | required, generated when empty |
| `lore-stations-github-app` | `lore-stations` | same three | required |
| `lore-github-oauth` | `lore-api` | `client-id`, `client-secret` | required by the chart, no longer read by lore-api |
| `lore-api-db-password` | `lore-api` | `password` | required, made by `lore-databases` |
| `lore-db-password` | `lore-ui` | `password` | required, made by `lore-databases` |
| `lore-stations-db-password` | `lore-stations` | `password` | required, made by `lore-databases` |
| `floor-postgres` | `lore-floor` | `connectionString` | required, made by `lore-databases` |
| `lore-ingest-token` | `lore-api`, `lore-stations` | `token` | generated |
| `lore-agent-internal-token` | `lore-api`, `lore-stations` | `token` | generated |
| `floor-service-token` | `lore-api`, `lore-stations` | `token` | generated |
| `floor-git-credential-token` | `lore-api` | `token` | generated |
| `lore-mcp-auth-token` | `lore-api` | `token` | generated |
| `lore-webhook-secret` | `lore-api` | `secret` | generated |
| `floor-api` | `lore-floor` | `serviceToken`, `visitTokenSecret`, `gitCredentialToken` | generated, must equal the floor tokens above |
| `lore-anthropic-key` | `lore-api` | `anthropic-api-key` | optional |
| `lore-stations-anthropic-key` | `lore-stations` | `anthropic-api-key` | optional |
| `lore-openai-key` | `lore-api` | `api-key` | optional |
| `lore-stations-openai-key` | `lore-stations` | `api-key` | optional |
| `lore-slack-credentials` | `lore-api` | `signing-secret`, `bot-token` | optional |
| `lore-stations-slack` | `lore-stations` | `bot-token` | optional |
| `ghcr-pull-secret` | `lore-api`, `lore-ui`, `lore-stations` | `.dockerconfigjson` | only for a private registry |
| `utopia-oauth` | `lore-floor` | `client-id`, `client-secret`, `cookie-secret` | required with Utopia (`secrets.oidc`) |
| `utopia-db-credentials` | `lore-floor` | `username` (`utopia`), `password` | generated, Utopia only |
| `utopia-app-db-credentials` | `lore-floor` | `username` (`utopia_app`), `password` | generated, Utopia only |
| `utopia-app` | `lore-floor` | `secret-key` (64 hex characters) | generated, Utopia only |

`agent-secrets` in `lore-floor` belongs to the floor chart (it holds the agents' model key).

## Identity and the one identity provider block

A workload identity is a label and an annotation, set by values and not by the chart:
`podLabels`, `podAnnotations` and `serviceAccount.annotations` under each app (`global.podLabels`
and `global.podAnnotations` for all of them). The examples show Azure Workload Identity and the
GKE service account annotation.

`global.oidc` (`issuer`, `allowedDomains`) and `secrets.oidc` (`clientId`, `clientSecret`) are
one OpenID Connect client, Microsoft Entra ID or any other issuer, for signing in to Utopia.
`utopia.oidc` must repeat the two values of `global.oidc`, and the install stops when they differ.
Both are required only when `utopia.enabled` is true.

## Other settings

- A pack, your own agents and assembly lines: set `LORE_PACK_REPO` and `LORE_PACK_REF` under `lore-platform.lore-api.env` and `lore-platform.lore-stations.env` ([pack layout reference](https://github.com/re-cinq/lore/blob/main/docs/using-lore/pack-layout-reference.md)).
- Metrics: `lore-platform.platform.monitoring.enabled: true` renders the ServiceMonitors and the Grafana dashboards, and needs kube-prometheus-stack on the cluster.
- Slack: `secrets.slack.signingSecret` and `secrets.slack.botToken`, both or neither.
- A Claude Code OAuth token for agents instead of an API key: `floor.clusterAgent.modelSecretKeys: claude=CLAUDE_CODE_OAUTH_TOKEN`.
- Images are multi-arch (amd64 and arm64).
