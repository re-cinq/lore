# ai-agent-subsystem (`ai-agents-helm`)

The **agent execution subsystem** — the external controller that turns an
`Agent` custom resource into an ephemeral Job pod, deployed into the
**`ai-agents`** namespace. The controller's source lives in its own repository
and ships as `ghcr.io/re-cinq/ai-agent-controller`, pinned **by digest** in
`values.yaml`; this chart is the piece of it that Lore owns — the CRDs, the
controller Deployment, the seeded recipe catalog, and the network fences. See
[ADR-031](../../../../../../../adrs/ADR-031-agent-station-crds.md) for why
Agent / Station / AgentDefinition are Kubernetes CRDs in a standalone
subsystem.

## What the chart ships

- **Three CRDs** (`crds/`): `Agent` (one run: prompt + repo + recipe),
  `Station` (the PodTemplate a run executes on), `AgentDefinition` (the
  recipe: prompt, model, timeout, image). Helm's native `crds/` handling is
  **install-only**, so `templates/crd-upgrade-job.yaml` re-applies them as a
  `pre-upgrade` hook on every deploy — schema changes reach live clusters
  (#1134). The hook's kubectl image comes from `registry.k8s.io` on purpose:
  guaranteed tags, no Docker Hub pull limits.
- **The controller** (`templates/controller.yaml` + RBAC): watches `Agent`
  CRs and stamps one Job pod per run. Pods run as non-root with dropped
  capabilities.
- **The seeded catalog** (`files/catalog-seed.yaml`, applied by the
  catalog-seed `pre-upgrade` hook): the builtin `AgentDefinition`/`Station`
  recipes **generated** from [`scripts/task-types.yaml`](../../../../../../../scripts/task-types.yaml)
  by gen-catalog — never edit the seed by hand. While `seedCatalog: true` the
  chart owns every field of the seeded recipes and re-asserts them each deploy,
  so a pruned or hand-edited field cannot survive one (#1468). Per-repo
  override recipes are separate objects and are never touched.
- **Network fences** (`templates/networkpolicy.yaml`): run pods get only
  public `:443` egress plus exactly one RFC1918 exception — the Floor's
  `/api/agent-events` NDJSON sink (`agentEventsUrl` / `floorSink` must agree).

## How a run reaches it

The Floor dispatches through the **cluster-agent** (`/api/cluster/*`) — no
Lore service holds a Kubernetes client of its own. A terminal CR is observed
by a streaming watch and reported to the event-router as a
`kubernetes.agent*` event; agent pods reach Lore context through the
**lore-mcp gateway** over HTTPS, never the database.

## Boundaries

- The controller's code, its release cadence, and the `Agent` reconcile logic
  live in the external repository — this chart only pins and configures a
  digest of it. Bump the digest deliberately.
- Floor deploys do not touch running Agents: tasks survive rollout restarts.
