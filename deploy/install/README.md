# lore-install

One chart that installs Lore, the floor, the agent subsystem and, if you want it, Utopia.
Start from `values.minimal.example.yaml` (GitHub, one model key, hostnames, nothing else)
or the example for your cluster: `values.aks.example.yaml`, `values.gke.example.yaml`,
`values.local.example.yaml`. Only GitHub is mandatory.

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
| `github-app-credentials` | `lore-api`, `lore-ui` | `app-id`, `private-key`, `installation-id` | required |
| `lore-stations-github-app` | `lore-stations` | same three | required |
| `lore-github-oauth` | `lore-api` | `client-id`, `client-secret` | required |
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
one OpenID Connect client, Microsoft Entra ID or any other issuer. Utopia reads it today through
`utopia.oidc`, which must repeat `global.oidc` until Utopia reads the shared block; Lore does not
use it yet. Both are required only when `utopia.enabled` is true.

## Other settings

- A pack, your own agents and assembly lines: set `LORE_PACK_REPO` and `LORE_PACK_REF` under `lore-platform.lore-api.env` and `lore-platform.lore-stations.env` ([pack layout reference](../../docs/using-lore/pack-layout-reference.md)).
- Metrics: `lore-platform.platform.monitoring.enabled: true` renders the ServiceMonitors and the Grafana dashboards, and needs kube-prometheus-stack on the cluster.
- Slack: `secrets.slack.signingSecret` and `secrets.slack.botToken`, both or neither.
- A Claude Code OAuth token for agents instead of an API key: `floor.clusterAgent.modelSecretKeys: claude=CLAUDE_CODE_OAUTH_TOKEN`.
- Images are multi-arch (amd64 and arm64).
