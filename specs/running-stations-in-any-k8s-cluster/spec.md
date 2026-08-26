# Feature Specification: Running Stations in Any Kubernetes Cluster

| Field    | Value                                          |
|----------|------------------------------------------------|
| Feature  | Running Stations in Any Kubernetes Cluster     |
| Branch   | (unassigned)                                   |
| Status   | Draft                                          |
| Created  | 2026-08-26                                     |
| Owner    | Platform Engineering                           |

Running Stations in Any Kubernetes Cluster lets a repo's assembly-line station
runs execute on clusters Lore does not own — a developer's minikube, a customer
cluster, a GPU box — by registering one cluster-agent per execution cluster,
tagging every station run with the capabilities it requires, and flipping node
dispatch from a push to the one configured cluster to an atomic pull-based
claim, the GitLab Runner model applied to AI stations.

## Problem Statement

Every station run today executes on the single GKE cluster Lore is deployed
to. The Floor's assembly-line walk pushes each node to one configured
`CLUSTER_AGENT_URL`, so the set of machines that can run an AI station is
exactly one, chosen at deploy time. Local Kubernetes clusters, customer-owned
clusters, and specialised hardware are structurally excluded — not by policy
but because nothing can register them, nothing can describe what they offer,
and no dispatch path can reach them (most are unreachable for inbound calls
anyway).

The groundwork for lifting this exists. ADR-044 extracted **cluster-agent** as
the only process holding a Kubernetes client, one per cluster, reporting
terminal Agent CR phases inward over HTTP through the event-router's
`POST /api/events` front door — recorded explicitly as "what allows more than
one execution cluster". `HttpEventReporter` already names the satellite-cluster
producer as its reason to exist. What is missing is the registry (which
clusters exist), the capability model (what each can run), and the claim-based
dispatch (how work reaches a cluster that cannot be reached).

## Design Decision: the satellite is a cluster-agent, not a second Floor

The original feature prompt framed the remote executor as a "satellite Floor".
This spec deliberately rejects that framing. ADR-044's 2026-08-23 amendment
already weighed the two cuts and recorded the cheaper one: the Floor's cluster
surface is small, so the brain (event loop, assembly-line walk, merge
authority, crons, webhooks) stays central and only the thin per-cluster agent
multiplies. That extraction has since shipped as `apps/cluster-agent`. A
satellite therefore deploys the **existing cluster-agent image** plus the
ai-agents subsystem — no second Floor, no new mode of the Floor binary, no
Postgres credentials outside the central cluster.

ADR-044 is amended (not superseded) to record that multi-cluster, left open
there, is taken up in this shape.

## FR1 — Cluster-agent registry and identity

A new `pipeline.cluster_agents` table is the registry of execution clusters.

- A cluster-agent registers with `POST /api/cluster-agents/register`,
  authenticating with a pre-shared registration token
  (`LORE_CLUSTER_AGENT_REGISTRATION_TOKEN`), and receives a durable
  `cluster_agent_id` and a per-agent bearer token.
- The per-agent token is stored SHA-256-hashed in
  `pipeline.cluster_agents.token_hash`, following the existing
  `pipeline.api_tokens` pattern; every subsequent call from that agent
  authenticates with it.
- Registration is idempotent on `name`: re-registering an existing name
  rotates the token and updates `tags` and `cluster_info` rather than
  creating a duplicate row.
- The satellite persists its identity in a Kubernetes Secret
  (`lore-cluster-agent-identity`) so pod restarts do not re-register.
- The registry ships as migration `0049_cluster_agent_registry.sql` (number
  adjusted to the next free slot at merge time): the table plus columns
  `cluster_agent_id`, `required_tags`, `claimed_at` on
  `pipeline.station_runs`.
- A `ClusterAgent` Zod model in `libs/shared/src/models/` and a
  port + Pg adapter + InMemory double under
  `libs/shared/src/project/cluster-agents/` follow the house pattern.

## FR2 — Capability tags

Capabilities are a flat tag set, matched by inclusion — no scheduler, no
scoring.

- A cluster-agent declares `tags: text[]` at registration (for example
  `["node:agent", "node:validate", "gpu"]`).
- Every station run carries `required_tags: text[]` (default `{}`); a
  cluster-agent may claim a run only when `required_tags <@ tags`.
- Assembly-line YAML nodes accept an optional `required_tags` list in the
  loader schema; an absent list inherits the repo-level default
  `settings.station_default_tags`, and an absent default means `{}`.
- A run with `required_tags = '{}'` is claimable by every registered
  cluster-agent, so existing definitions keep working unchanged.

## FR3 — Claim-based dispatch

Dispatch flips from push to pull, because a minikube or customer cluster is
unreachable for inbound calls — the defining constraint of the GitLab Runner
model. The central cluster's agent claims through the same path, so there is
one dispatch mechanism, not a special case plus a remote case.

- The Floor's launch seam writes the station run as `queued`, carrying the
  complete dispatch spec (node type, agent definition, target repo, branch,
  args, conversation, timeout) instead of calling the cluster-agent directly.
- A cluster-agent polls `POST /api/cluster-agents/{id}/claim` on a
  configurable interval (default 15 s); the claim is a single
  `SELECT … FOR UPDATE SKIP LOCKED` CTE that sets `status`,
  `cluster_agent_id`, and `claimed_at` in one statement, so concurrent
  claimants are safe.
- A claim request with no matching queued run returns `204`.
- The claiming cluster-agent dispatches the Agent CR to its own cluster's
  ai-agents subsystem, exactly as it does today for the central cluster.
- Outcome reporting is unchanged: the cluster-agent's existing watch reports
  terminal phases through the event-router front door with dedupe keys, and
  the central Floor's event loop advances the assembly line without knowing
  or caring which cluster executed the node.

## FR4 — Liveness and dead-agent reaping

A registered cluster that dies must not strand its claims.

- A cluster-agent posts `POST /api/cluster-agents/{id}/heartbeat` every 30 s,
  bumping `last_seen_at`.
- The assembly-run reaper marks cluster-agents with
  `last_seen_at < now() - 2 minutes` as `offline`.
- Station runs claimed by an offline cluster-agent and past their node
  timeout are reset to `queued` and recorded in `pipeline.audit_log` as
  `cluster_agent_offline`, so another agent picks them up.
- A returning agent re-registers under its persisted identity and resumes
  claiming; its stale claims have already been requeued, and dedupe keys make
  any late duplicate report safe.

## FR5 — Standalone satellite chart

One `helm install` turns any cluster with outbound HTTPS into a Lore
execution node.

- A new `charts/lore-cluster-agent-standalone` chart bundles the existing
  cluster-agent (configured as a satellite) with the ai-agents subsystem —
  both halves in one chart, per the feature's locked decision.
- Required values: `loreApiUrl`, `registrationToken`, `name`, `tags`, GHCR
  pull credentials, and an LLM credential. No Postgres values exist in the
  chart at all.
- `scripts/check-lore-cluster-agent-standalone-render.sh` renders the chart
  in CI, mirroring the existing chart-render checks.
- The local dev flow gains a flag that installs the standalone chart against
  minikube, making "laptop cluster registers, claims a run, PR appears" the
  acceptance walk for the whole feature.

## FR6 — Registered-clusters visibility

Operators need to see which clusters exist, what they can run, and whether
they are alive.

- `GET /api/cluster-agents` lists registered agents with `name`, `tags`,
  `status`, `last_seen_at`, and the count of runs each is currently
  executing.
- A web-ui page renders that list, marking offline agents and linking each
  running claim to its assembly-run page.
- The audit log's `cluster_agent_offline` entries surface on the same page,
  so a flapping cluster is diagnosable without database access.

## Data Model

```sql
CREATE TABLE pipeline.cluster_agents (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name           text NOT NULL UNIQUE,
  tags           text[] NOT NULL DEFAULT '{}',
  token_hash     text NOT NULL,
  registered_at  timestamptz NOT NULL DEFAULT now(),
  last_seen_at   timestamptz NOT NULL DEFAULT now(),
  status         text NOT NULL DEFAULT 'active',
  cluster_info   jsonb
);
```

`pipeline.station_runs` gains `cluster_agent_id uuid`, `required_tags text[]
NOT NULL DEFAULT '{}'`, and `claimed_at timestamptz`.

## Out of Scope

- Scheduling beyond tag inclusion — no load balancing, priorities, or
  affinity. First matching claimant wins.
- Running the central Floor, event-router, or any Postgres-holding process
  outside the central cluster.
- Non-Kubernetes execution backends (the GitHub Actions backend direction
  tracked in #1105 is unaffected and separate).
- Billing or quota separation per registered cluster.
- Automatic registration-token rotation; the pre-shared token is operator-
  managed like the existing scoped API tokens.

## Verification

- FR1: registering twice under one name yields one row with a rotated token;
  a call with a stale token is rejected.
- FR2: a run requiring `gpu` is never handed to an agent without it; a run
  with empty `required_tags` is claimable by any agent.
- FR3: two agents claiming concurrently never receive the same run; the
  minikube acceptance walk ends with a PR authored from a locally executed
  station run.
- FR4: killing a satellite mid-run requeues its claim within one reaper
  cycle plus the node timeout, with a `cluster_agent_offline` audit entry.
- FR5: the standalone chart renders in CI with only the documented values;
  a rendered manifest contains no Postgres reference.
- FR6: the cluster list shows a just-registered agent as `active` and flips
  it to `offline` within two minutes of its last heartbeat.
