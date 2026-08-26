# Feature Specification: Running Stations in Any Kubernetes Cluster

| Field     | Value                                          |
|-----------|------------------------------------------------|
| Feature   | Running Stations in Any Kubernetes Cluster     |
| Branch    | feat/cluster-agent-registry (stacked to feat/clusters-ui) |
| Status    | In Progress                                    |
| Created   | 2026-08-26                                     |
| Owner     | Platform Engineering                           |
| Builds on | [ADR-044](../../adrs/ADR-044-event-router-owns-the-event-bus.md) |

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
one execution cluster". `HttpEventReporter`
(`libs/shared/src/project/events/event-reporter-http.ts`) exists precisely so
a producer can report from somewhere the database does not reach (its header
comment is corrected in this change to name the satellite cluster-agent this
spec defines, rather than the satellite Floor it predates). What is missing is
the registry (which clusters exist), the capability model (what each can run),
and the claim-based dispatch (how work reaches a cluster that cannot be
reached).

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

## Station-run lifecycle

Today a `pipeline.station_runs` row is written at dispatch time, "open" means
`outcome IS NULL`, and the reaper measures the node's timeout from
`started_at`. Pull-based dispatch introduces a phase that table cannot
express — written but not yet claimed — so the lifecycle is made explicit
rather than smuggled through existing columns:

- `pipeline.station_runs` gains `status text NOT NULL DEFAULT 'running'` with
  values `queued` (written by the launch seam, unclaimed), `claimed` (a
  cluster-agent took it, Agent CR not yet confirmed), and `running` (the
  default, and the backfill value for every existing row). `status` is
  meaningful only while `outcome IS NULL`; terminality stays exactly what it
  is today — a non-null `outcome` — so `nextTransition()`'s await logic
  (`visits.some(v => v.outcome === null)`) is untouched. ([validated by `advance.test.ts:1414`](apps/floor/src/jobs/assembly-run/advance.test.ts#L1414))
- `started_at` keeps its NOT NULL row-creation meaning (now: enqueue time).
  Execution timing moves to the new `claimed_at`: the reaper measures the
  node's `timeout_minutes` budget from `claimed_at`, never from `started_at`,
  so time spent waiting for a capable cluster is not charged against
  execution. ([validated by `assembly-run-reaper.test.ts:138`](apps/floor/src/jobs/assembly-run/assembly-run-reaper.test.ts#L138), [`assembly-run-reaper.test.ts:646`](apps/floor/src/jobs/assembly-run/assembly-run-reaper.test.ts#L646), [`assembly-run-reaper.test.ts:121`](apps/floor/src/jobs/assembly-run/assembly-run-reaper.test.ts#L121))
- A run that sits `queued` longer than a configurable queue-wait bound
  (default 30 minutes) is failed terminally with the existing
  `failure_class` mechanics and a detail naming the unmatched
  `required_tags` — a line stalled because no registered cluster carries a
  tag must say so, not report a generic infra timeout. ([validated by `assembly-run-reaper.test.ts:169`](apps/floor/src/jobs/assembly-run/assembly-run-reaper.test.ts#L169), [`assembly-run-reaper.test.ts:566`](apps/floor/src/jobs/assembly-run/assembly-run-reaper.test.ts#L566), [`assembly-run-reaper.test.ts:456`](apps/floor/src/jobs/assembly-run/assembly-run-reaper.test.ts#L456), [`assembly-run-reaper.test.ts:287`](apps/floor/src/jobs/assembly-run/assembly-run-reaper.test.ts#L287), [`assembly-run-reaper.test.ts:292`](apps/floor/src/jobs/assembly-run/assembly-run-reaper.test.ts#L292), [`assembly-run-reaper.test.ts:163`](apps/floor/src/jobs/assembly-run/assembly-run-reaper.test.ts#L163), [`assembly-run-reaper.test.ts:584`](apps/floor/src/jobs/assembly-run/assembly-run-reaper.test.ts#L584))
- Requeueing (FR4) resets the **same row** back to `queued`, clearing
  `cluster_agent_id` and `claimed_at`. No second row is inserted, so the
  row-id-as-visit-order contract the fork replay depends on
  (`assembly-runs-pg.ts`) sees exactly one row per node visit, claimed or
  not. ([validated by `assembly-run-reaper.test.ts:611`](apps/floor/src/jobs/assembly-run/assembly-run-reaper.test.ts#L611), [`assembly-run-reaper.test.ts:108`](apps/floor/src/jobs/assembly-run/assembly-run-reaper.test.ts#L108), [`assembly-run-reaper.test.ts:96`](apps/floor/src/jobs/assembly-run/assembly-run-reaper.test.ts#L96), [`assembly-runs.contract.test.ts:991`](libs/shared/src/project/assembly-runs/assembly-runs.contract.test.ts#L991))

## FR1 — Cluster-agent registry and identity

A new `pipeline.cluster_agents` table is the registry of execution clusters.

- A cluster-agent registers with `POST /api/cluster-agents/register` on
  lore-api (all `/api/cluster-agents/*` endpoints live in
  `apps/lore-api/src/api/routes/cluster-agents/`), authenticating with a
  pre-shared registration token (`LORE_CLUSTER_AGENT_REGISTRATION_TOKEN`),
  and receives a durable id and a per-agent bearer token. ([validated by `register.test.ts:44`](apps/lore-api/src/api/routes/cluster-agents/register.test.ts#L44), [`register.test.ts:14`](apps/lore-api/src/api/routes/cluster-agents/register.test.ts#L14), [`register.test.ts:31`](apps/lore-api/src/api/routes/cluster-agents/register.test.ts#L31), [`registration.test.ts:121`](apps/cluster-agent/src/satellite/registration.test.ts#L121), [`registration.test.ts:154`](apps/cluster-agent/src/satellite/registration.test.ts#L154), [`registration.test.ts:46`](apps/cluster-agent/src/satellite/registration.test.ts#L46), [`registration.test.ts:52`](apps/cluster-agent/src/satellite/registration.test.ts#L52), [`registration.test.ts:61`](apps/cluster-agent/src/satellite/registration.test.ts#L61), [`registration.test.ts:76`](apps/cluster-agent/src/satellite/registration.test.ts#L76), [`registration.test.ts:175`](apps/cluster-agent/src/satellite/registration.test.ts#L175), [`registration.test.ts:189`](apps/cluster-agent/src/satellite/registration.test.ts#L189))
- The per-agent token is stored SHA-256-hashed in
  `pipeline.cluster_agents.token_hash`, following the existing
  `pipeline.api_tokens` pattern; every subsequent lore-api call from that
  agent authenticates with it. ([validated by `cluster-agents.test.ts:67`](libs/shared/src/project/cluster-agents/cluster-agents.test.ts#L67), [`cluster-agents.test.ts:75`](libs/shared/src/project/cluster-agents/cluster-agents.test.ts#L75))
- A failed registration attempt is retried on a 30-second schedule doubling
  to a 5-minute cap, and never crashes the process — the agent's other
  duties (the watch, the inbound routes) do not depend on it. ([validated by `registration.test.ts:101`](apps/cluster-agent/src/satellite/registration.test.ts#L101), [`registration.test.ts:105`](apps/cluster-agent/src/satellite/registration.test.ts#L105))
- Registration is idempotent on `name` — but only for the identity holder:
  re-registering an existing name **with the current per-agent bearer token**
  rotates the token and updates `tags` and `cluster_info`. Re-registering a
  known name without it is rejected `409` — the shared registration token
  alone must never suffice to take over a live cluster's identity. ([validated by `register.test.ts:67`](apps/lore-api/src/api/routes/cluster-agents/register.test.ts#L67), [`register.test.ts:93`](apps/lore-api/src/api/routes/cluster-agents/register.test.ts#L93), [`cluster-agents.test.ts:42`](libs/shared/src/project/cluster-agents/cluster-agents.test.ts#L42), [`cluster-agents.test.ts:46`](libs/shared/src/project/cluster-agents/cluster-agents.test.ts#L46), [`cluster-agents.test.ts:55`](libs/shared/src/project/cluster-agents/cluster-agents.test.ts#L55), [`cluster-agents.test.ts:59`](libs/shared/src/project/cluster-agents/cluster-agents.test.ts#L59), [`registration.test.ts:167`](apps/cluster-agent/src/satellite/registration.test.ts#L167))
- Two concurrent first registrations of the same name resolve to one
  identity: the insert is conflict-safe, and the loser receives the same
  `409` as any other taken name — never a 500. ([validated by `register.test.ts:122`](apps/lore-api/src/api/routes/cluster-agents/register.test.ts#L122), [`cluster-agents.test.ts:117`](libs/shared/src/project/cluster-agents/cluster-agents.test.ts#L117))
- Credential handling is uniform across the cluster-agent endpoints: the
  `Authorization` header is parsed by the shared `extractBearer` — anchored
  to the start, scheme case-insensitive per RFC 7235, first value of a
  multi-value header — and secrets (registration token, token hashes) are
  compared constant-time via the shared `secretEquals`. ([validated by `bearer.test.ts:5`](libs/shared/src/http/bearer.test.ts#L5), [`bearer.test.ts:9`](libs/shared/src/http/bearer.test.ts#L9), [`bearer.test.ts:14`](libs/shared/src/http/bearer.test.ts#L14), [`bearer.test.ts:18`](libs/shared/src/http/bearer.test.ts#L18), [`bearer.test.ts:28`](libs/shared/src/http/bearer.test.ts#L28))
- The satellite persists its identity (`{id, token}`) at
  `LORE_CLUSTER_AGENT_IDENTITY_FILE` — which the standalone chart mounts
  from a Kubernetes Secret named `lore-cluster-agent-identity` — so pod
  restarts do not re-register; re-registration presents the persisted
  token. ([validated by `identity-store.test.ts:39`](apps/cluster-agent/src/satellite/identity-store.test.ts#L39), [`identity-store.test.ts:15`](apps/cluster-agent/src/satellite/identity-store.test.ts#L15), [`identity-store.test.ts:24`](apps/cluster-agent/src/satellite/identity-store.test.ts#L24), [`identity-store.test.ts:32`](apps/cluster-agent/src/satellite/identity-store.test.ts#L32), [`identity-store.test.ts:48`](apps/cluster-agent/src/satellite/identity-store.test.ts#L48), [`identity-store.test.ts:59`](apps/cluster-agent/src/satellite/identity-store.test.ts#L59), [`identity-store.test.ts:68`](apps/cluster-agent/src/satellite/identity-store.test.ts#L68), [`identity-store.test.ts:79`](apps/cluster-agent/src/satellite/identity-store.test.ts#L79), [`registration.test.ts:141`](apps/cluster-agent/src/satellite/registration.test.ts#L141))
- The registry ships as the next migration in sequence
  (`NNNN_cluster_agent_registry.sql`) under
  `infra/terraform/modules/gke-mcp/lore-platform/charts/ui-helm/migrations/`:
  the table plus columns `status`, `cluster_agent_id`, `required_tags`,
  `claimed_at` on `pipeline.station_runs`.
- A `ClusterAgent` Zod model in `libs/shared/src/models/` and a
  port + Pg adapter + InMemory double under
  `libs/shared/src/project/cluster-agents/` follow the house pattern. ([validated by `cluster-agents.test.ts:92`](libs/shared/src/project/cluster-agents/cluster-agents.test.ts#L92), [`cluster-agents.test.ts:138`](libs/shared/src/project/cluster-agents/cluster-agents.test.ts#L138), [`cluster-agents.test.ts:215`](libs/shared/src/project/cluster-agents/cluster-agents.test.ts#L215), [`cluster-agents.test.ts:236`](libs/shared/src/project/cluster-agents/cluster-agents.test.ts#L236), [`cluster-agents.test.ts:259`](libs/shared/src/project/cluster-agents/cluster-agents.test.ts#L259))

## FR2 — Capability tags

Capabilities are a flat tag set, matched by inclusion — no scheduler, no
scoring.

- A cluster-agent declares `tags: text[]` at registration (for example
  `["node:agent", "node:validate", "gpu"]`). ([validated by `register.test.ts:44`](apps/lore-api/src/api/routes/cluster-agents/register.test.ts#L44), [`registration.test.ts:87`](apps/cluster-agent/src/satellite/registration.test.ts#L87), [`registration.test.ts:95`](apps/cluster-agent/src/satellite/registration.test.ts#L95), [`registration.test.ts:67`](apps/cluster-agent/src/satellite/registration.test.ts#L67))
- Every station run carries `required_tags: text[]` (default `{}`); a
  cluster-agent may claim a run only when `required_tags <@ tags`. ([validated by `required-tags.test.ts:5`](libs/shared/src/project/cluster-agents/required-tags.test.ts#L5), [`required-tags.test.ts:11`](libs/shared/src/project/cluster-agents/required-tags.test.ts#L11), [`advance.test.ts:1441`](apps/floor/src/jobs/assembly-run/advance.test.ts#L1441))
- Assembly-line YAML nodes accept an optional `required_tags` list in the
  loader schema; an absent list inherits the repo-level default
  `settings.station_default_tags`, and an absent default means `{}`. The
  default is applied at enqueue time, never baked into the parsed
  definition, so it stays out of `definitionHash`. ([validated by `loader.test.ts:1027`](libs/assembly-lines/src/loader.test.ts#L1027), [`loader.test.ts:1045`](libs/assembly-lines/src/loader.test.ts#L1045), [`loader.test.ts:1053`](libs/assembly-lines/src/loader.test.ts#L1053), [`snapshot-graph.test.ts:91`](libs/assembly-lines/src/snapshot-graph.test.ts#L91), [`advance.test.ts:1467`](apps/floor/src/jobs/assembly-run/advance.test.ts#L1467), [`required-tags.test.ts:22`](libs/shared/src/project/cluster-agents/required-tags.test.ts#L22), [`required-tags.test.ts:31`](libs/shared/src/project/cluster-agents/required-tags.test.ts#L31), [`required-tags.test.ts:37`](libs/shared/src/project/cluster-agents/required-tags.test.ts#L37))
- A run with `required_tags = '{}'` is claimable by every registered
  cluster-agent, so existing definitions keep working unchanged. ([validated by `required-tags.test.ts:15`](libs/shared/src/project/cluster-agents/required-tags.test.ts#L15))

## FR3 — Claim-based dispatch

Dispatch flips from push to pull, because a minikube or customer cluster is
unreachable for inbound calls — the defining constraint of the GitLab Runner
model. The central cluster's agent claims through the same path, so there is
one dispatch mechanism, not a special case plus a remote case.

- The Floor's launch seam writes the station run as `queued`, carrying the
  complete dispatch spec (node type, target repo, branch, args, conversation,
  timeout) instead of calling the cluster-agent directly. Only nodes that
  reach the launch seam are enqueued — human-station and service-node rows
  never become `queued` and are therefore never claimable. ([validated by `advance.test.ts:1414`](apps/floor/src/jobs/assembly-run/advance.test.ts#L1414), [`advance.test.ts:1478`](apps/floor/src/jobs/assembly-run/advance.test.ts#L1478), [`advance.test.ts:1505`](apps/floor/src/jobs/assembly-run/advance.test.ts#L1505))
- A cluster-agent polls `POST /api/cluster-agents/{id}/claim` on a
  configurable interval (default 15 s); the claim is a single
  `SELECT … FOR UPDATE SKIP LOCKED` CTE that sets `status = 'claimed'`,
  `cluster_agent_id`, and `claimed_at` in one statement, so concurrent
  claimants are safe. ([validated by `claim.test.ts:90`](apps/lore-api/src/api/routes/cluster-agents/claim.test.ts#L90), [`assembly-runs.contract.test.ts:899`](libs/shared/src/project/assembly-runs/assembly-runs.contract.test.ts#L899), [`assembly-runs.contract.test.ts:959`](libs/shared/src/project/assembly-runs/assembly-runs.contract.test.ts#L959))
- Claim and heartbeat calls authenticate with the per-agent bearer token
  issued at registration, like every other lore-api call the agent makes. ([validated by `claim.test.ts:50`](apps/lore-api/src/api/routes/cluster-agents/claim.test.ts#L50), [`claim.test.ts:60`](apps/lore-api/src/api/routes/cluster-agents/claim.test.ts#L60), [`claim.test.ts:69`](apps/lore-api/src/api/routes/cluster-agents/claim.test.ts#L69), [`claim-loop.test.ts:119`](apps/cluster-agent/src/satellite/claim-loop.test.ts#L119), [`claim-loop.test.ts:164`](apps/cluster-agent/src/satellite/claim-loop.test.ts#L164), [`claim-loop.test.ts:170`](apps/cluster-agent/src/satellite/claim-loop.test.ts#L170), [`claim-loop.test.ts:244`](apps/cluster-agent/src/satellite/claim-loop.test.ts#L244))
- A claim request with no matching queued run returns `204`. An idle agent
  backs its polling off (doubling to a 60 s ceiling, resetting on the first
  hit), so a fleet of quiet satellites costs the API a bounded trickle
  rather than O(N) at the floor interval. ([validated by `claim.test.ts:78`](apps/lore-api/src/api/routes/cluster-agents/claim.test.ts#L78), [`claim.test.ts:116`](apps/lore-api/src/api/routes/cluster-agents/claim.test.ts#L116), [`claim-loop.test.ts:59`](apps/cluster-agent/src/satellite/claim-loop.test.ts#L59), [`claim-loop.test.ts:63`](apps/cluster-agent/src/satellite/claim-loop.test.ts#L63), [`claim-loop.test.ts:69`](apps/cluster-agent/src/satellite/claim-loop.test.ts#L69), [`claim-loop.test.ts:77`](apps/cluster-agent/src/satellite/claim-loop.test.ts#L77), [`claim-loop.test.ts:84`](apps/cluster-agent/src/satellite/claim-loop.test.ts#L84), [`claim-loop.test.ts:88`](apps/cluster-agent/src/satellite/claim-loop.test.ts#L88), [`claim-loop.test.ts:133`](apps/cluster-agent/src/satellite/claim-loop.test.ts#L133), [`claim-loop.test.ts:231`](apps/cluster-agent/src/satellite/claim-loop.test.ts#L231))
- The claim response carries the **complete `LoreTaskSpec`** the visit was
  enqueued with — the same object the push path handed the launch backend.
  The claiming cluster-agent materialises everything cluster-local itself:
  the builtin `def-<type>` catalog arrives with the ai-agents subchart it is
  installed beside, per-task token provisioning and the AgentDefinition +
  Station clone happen through its own provisioner, context hydration is
  fetched outbound from the Lore API (a satellite without the central
  ingest credential launches unhydrated — agent pods still carry the live
  lore-mcp gateway), and the Agent CR is created under the exact CR name
  the Floor recorded on the station-run row — so no synced catalog is
  required and no inbound push ever occurs. ([validated by `claim-loop.test.ts:139`](apps/cluster-agent/src/satellite/claim-loop.test.ts#L139), [`claim-loop.test.ts:152`](apps/cluster-agent/src/satellite/claim-loop.test.ts#L152), [`claim-loop.test.ts:176`](apps/cluster-agent/src/satellite/claim-loop.test.ts#L176), [`claim-loop.test.ts:187`](apps/cluster-agent/src/satellite/claim-loop.test.ts#L187), [`claim-loop.test.ts:194`](apps/cluster-agent/src/satellite/claim-loop.test.ts#L194), [`claim-loop.test.ts:253`](apps/cluster-agent/src/satellite/claim-loop.test.ts#L253), [`api-context-source.test.ts:36`](apps/cluster-agent/src/satellite/api-context-source.test.ts#L36), [`api-context-source.test.ts:56`](apps/cluster-agent/src/satellite/api-context-source.test.ts#L56), [`api-context-source.test.ts:67`](apps/cluster-agent/src/satellite/api-context-source.test.ts#L67), [`api-context-source.test.ts:75`](apps/cluster-agent/src/satellite/api-context-source.test.ts#L75), [`api-context-source.test.ts:83`](apps/cluster-agent/src/satellite/api-context-source.test.ts#L83))
- Outcome reporting rides the existing path: the cluster-agent's watch
  reports terminal phases through the event-router front door with dedupe
  keys, and the central Floor's event loop advances the assembly line
  without knowing which cluster executed the node.

## FR4 — Liveness, recovery, and dead-agent reaping

Recovery today assumes the reaper can interrogate the Agent CR — a pull
against the central cluster-agent. A satellite's CRs are invisible to that
pull, so recovery splits by who holds the claim:

- A cluster-agent posts `POST /api/cluster-agents/{id}/heartbeat` every 30 s,
  bumping `last_seen_at`. ([validated by `cluster-agents.test.ts:165`](libs/shared/src/project/cluster-agents/cluster-agents.test.ts#L165), [`cluster-agents.test.ts:288`](libs/shared/src/project/cluster-agents/cluster-agents.test.ts#L288), [`heartbeat.test.ts:22`](apps/lore-api/src/api/routes/cluster-agents/heartbeat.test.ts#L22), [`heartbeat.test.ts:38`](apps/lore-api/src/api/routes/cluster-agents/heartbeat.test.ts#L38), [`heartbeat-loop.test.ts:29`](apps/cluster-agent/src/satellite/heartbeat-loop.test.ts#L29), [`heartbeat-loop.test.ts:33`](apps/cluster-agent/src/satellite/heartbeat-loop.test.ts#L33), [`heartbeat-loop.test.ts:44`](apps/cluster-agent/src/satellite/heartbeat-loop.test.ts#L44), [`heartbeat-loop.test.ts:74`](apps/cluster-agent/src/satellite/heartbeat-loop.test.ts#L74))
- The assembly-run reaper (existing cadence) marks cluster-agents with
  `last_seen_at < now() - 5 minutes` as `offline` — ten missed heartbeats,
  so a transient network blip or one dropped request never requeues live
  work. ([validated by `cluster-agents.test.ts:185`](libs/shared/src/project/cluster-agents/cluster-agents.test.ts#L185), [`cluster-agents.test.ts:275`](libs/shared/src/project/cluster-agents/cluster-agents.test.ts#L275), [`assembly-run-reaper.test.ts:835`](apps/floor/src/jobs/assembly-run/assembly-run-reaper.test.ts#L835))
- The reaper's CR-status recovery arm (`readAgentStatus` → relaunch on null)
  applies **only** to runs claimed by the central cluster's agent — the one
  cluster `CLUSTER_AGENT_URL` can reach. For satellite-claimed runs that arm
  is skipped entirely; their recovery signal is the claiming agent's
  liveness, never a CR read that would come back null and trigger a
  duplicate central launch. ([validated by `assembly-run-reaper.test.ts:175`](apps/floor/src/jobs/assembly-run/assembly-run-reaper.test.ts#L175), [`assembly-run-reaper.test.ts:190`](apps/floor/src/jobs/assembly-run/assembly-run-reaper.test.ts#L190), [`assembly-run-reaper.test.ts:595`](apps/floor/src/jobs/assembly-run/assembly-run-reaper.test.ts#L595), [`assembly-run-reaper.test.ts:249`](apps/floor/src/jobs/assembly-run/assembly-run-reaper.test.ts#L249), [`assembly-run-reaper.test.ts:255`](apps/floor/src/jobs/assembly-run/assembly-run-reaper.test.ts#L255), [`assembly-run-reaper.test.ts:264`](apps/floor/src/jobs/assembly-run/assembly-run-reaper.test.ts#L264), [`assembly-run-reaper.test.ts:273`](apps/floor/src/jobs/assembly-run/assembly-run-reaper.test.ts#L273), [`assembly-run-reaper.test.ts:279`](apps/floor/src/jobs/assembly-run/assembly-run-reaper.test.ts#L279))
- A run claimed by an **offline** agent is reset to `queued` (same row, per
  the lifecycle section); the reaper — the same process that set the agent
  `offline` — writes a `cluster_agent_offline` entry to `pipeline.audit_log`
  recording the `cluster_agent_id`, the `station_run_id`, and the elapsed
  time since `claimed_at`, so another agent picks the run up and the outage
  is attributable. Re-execution resumes on the run's existing branch —
  branch-as-state already makes a node re-run land on whatever commits the
  dead attempt pushed. ([validated by `assembly-run-reaper.test.ts:835`](apps/floor/src/jobs/assembly-run/assembly-run-reaper.test.ts#L835), [`assembly-run-reaper.test.ts:803`](apps/floor/src/jobs/assembly-run/assembly-run-reaper.test.ts#L803), [`assembly-run-reaper.test.ts:817`](apps/floor/src/jobs/assembly-run/assembly-run-reaper.test.ts#L817), [`assembly-run-reaper.test.ts:895`](apps/floor/src/jobs/assembly-run/assembly-run-reaper.test.ts#L895))
- A run whose claiming agent is **alive** but which exceeds its node timeout
  (measured from `claimed_at`) is failed terminally, exactly the reaper's
  timeout semantics today — a live agent past budget is a stuck node, not a
  lost one, and requeueing it would double-execute its side effects.
- A returning agent re-registers under its persisted identity and resumes
  claiming; its stale claims have already been requeued, and dedupe keys make
  any late duplicate report safe. ([validated by `heartbeat-loop.test.ts:100`](apps/cluster-agent/src/satellite/heartbeat-loop.test.ts#L100), [`heartbeat-loop.test.ts:62`](apps/cluster-agent/src/satellite/heartbeat-loop.test.ts#L62))

## FR5 — Reporting credentials for satellites

A satellite must report outcomes without holding the bus-wide credential.

- The event-router's `POST /api/events` accepts, in addition to
  `LORE_INGEST_TOKEN`, per-agent bearer tokens verified against
  `pipeline.cluster_agents.token_hash` (the router already holds the pool;
  this is a lookup, not a new dependency). ([validated by [`reporter-auth.test.ts:66`](apps/event-router/src/delivery/routes/reporter-auth.test.ts#L66), [`reporter-auth.test.ts:102`](apps/event-router/src/delivery/routes/reporter-auth.test.ts#L102), [`reporter-auth.test.ts:112`](apps/event-router/src/delivery/routes/reporter-auth.test.ts#L112))
- Satellites report with their per-agent token; `LORE_INGEST_TOKEN` never
  leaves the central cluster — and a per-agent token authorises the
  reporting front door only, never the router's other surfaces. ([validated by [`server-auth.test.ts:39`](apps/event-router/src/delivery/server-auth.test.ts#L39))
- Deregistering or rotating a cluster-agent's token immediately invalidates
  its reporting credential — one revocation surface for both claiming and
  reporting. An agent already marked offline still delivers a late terminal
  report — dedupe keys make a duplicate safe, and losing the report would
  lose the work. ([validated by [`reporter-auth.test.ts:77`](apps/event-router/src/delivery/routes/reporter-auth.test.ts#L77), [`reporter-auth.test.ts:90`](apps/event-router/src/delivery/routes/reporter-auth.test.ts#L90))

## FR6 — Standalone satellite chart

One `helm install` turns any cluster with outbound HTTPS into a Lore
execution node.

- A new chart at
  `infra/terraform/modules/gke-mcp/lore-platform/charts/cluster-agent-standalone-helm/`
  (the repo's chart directory and `-helm` naming convention; deliberately
  **not** added to the `lore-platform` umbrella's dependencies — it is
  installed standalone on the satellite) bundles the existing cluster-agent
  image, configured as a satellite, with the ai-agents subsystem — both
  halves in one chart, per the feature's locked decision.
- Required values: `loreApiUrl`, `eventRouterUrl`, `registrationToken`,
  `name`, `tags`, GHCR pull credentials, and an LLM credential. No Postgres
  values exist in the chart at all.
- `scripts/check-cluster-agent-standalone-render.sh` renders the chart in
  CI; `.github/workflows/helm-render.yml` gains both the `paths:` entries
  and the job for it, since that workflow hardcodes each render check by
  hand rather than globbing.
- The local dev flow gains a flag that installs the standalone chart against
  minikube, making "laptop cluster registers, claims a run, PR appears" the
  acceptance walk for the whole feature.

## FR7 — Registered-clusters visibility

Operators need to see which clusters exist, what they can run, and whether
they are alive.

- `GET /api/cluster-agents` lists registered agents with `name`, `tags`,
  `status`, `last_seen_at`, and the count of runs each is currently
  executing. ([validated by `assembly-runs.contract.test.ts:1035`](libs/shared/src/project/assembly-runs/assembly-runs.contract.test.ts#L1035))
- A web-ui page renders that list, marking offline agents and linking each
  running claim to its assembly-run page.
- The audit log's `cluster_agent_offline` entries surface on the same page,
  so a flapping cluster is diagnosable without database access. ([validated by `audit-read.test.ts:7`](libs/shared/src/project/audit/audit-read.test.ts#L7), [`audit-read.test.ts:24`](libs/shared/src/project/audit/audit-read.test.ts#L24))

## Data Model

```sql
CREATE TABLE pipeline.cluster_agents (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name           text NOT NULL UNIQUE,
  tags           text[] NOT NULL DEFAULT '{}',
  token_hash     text NOT NULL,
  registered_at  timestamptz NOT NULL DEFAULT now(),
  last_seen_at   timestamptz NOT NULL DEFAULT now(),
  status         text NOT NULL DEFAULT 'active'
                   CHECK (status IN ('active', 'offline')),
  cluster_info   jsonb  -- operator metadata, e.g. {"k8s_version": "1.30", "region": "eu-west4", "gpu": "h100"}
);
```

`pipeline.station_runs` gains `status text NOT NULL DEFAULT 'running'`
(lifecycle section above; the default doubles as the backfill for existing
rows), `cluster_agent_id uuid` (a correlation id, deliberately no foreign
key — the `agent_run_events` precedent: the claimant is authenticated
against the registry at the API layer, and a claim row must survive
registry churn rather than block on it), `required_tags text[] NOT NULL
DEFAULT '{}'`, `claimed_at timestamptz`, and `dispatch_spec jsonb` (the
complete machine contract a claimant runs with, written at enqueue — only
armed rows are claimable), plus a partial index on `(status) WHERE outcome
IS NULL` to back the claim scan. A queued visit with no armed dispatch
contract is never handed to a claimant. ([validated by `assembly-runs.contract.test.ts:940`](libs/shared/src/project/assembly-runs/assembly-runs.contract.test.ts#L940))

## Rollout: from push to pull without a flag-day

The cutover from `ClusterAgentClient` push to claim-based pull is staged so
every deploy leaves a working dispatch path:

1. **Registry first** (FR1/FR2): the migration, endpoints, and tag columns
   land while the launch seam still pushes. Nothing consumes them yet;
   `status` defaults every existing and newly pushed row to `running`, which
   is exactly what the push path means.
2. **The central agent registers and claims**: the central cluster-agent
   deploys with the claim loop enabled and registers itself (tags covering
   every node type). The launch seam still pushes, so the claim loop finds
   nothing `queued` — both paths are live, one is idle.
3. **The seam flips**: the Floor deploys with the launch seam writing
   `queued` instead of pushing. In-flight runs dispatched under push are
   untouched — their rows are `running` with an Agent CR, and the reaper's
   existing CR-status arm covers them to terminality. New launches are
   claimed by the central agent within one poll interval.
4. **The push path is deleted** once no pre-flip run is open: the launch
   seam's `ClusterAgentClient` dispatch call and its wiring go away
   (delete-dead, not dedup). Satellites can register from step 3 onward.

Rollback at any stage is the reverse deploy; step 3's flip is the only
behavioural change, and it is a single deploy boundary, not a long-lived
config flag.

## Out of Scope

- Scheduling beyond tag inclusion — no load balancing, priorities, or
  affinity. First matching claimant wins.
- Running the central Floor, event-router, or any Postgres-holding process
  outside the central cluster.
- Live pod-log viewing for satellite-executed runs. The run page's log
  viewer pulls from the central cluster-agent; a satellite run falls back to
  the existing "not retained" path in this iteration. Turn-level transcripts
  (`pipeline.agent_run_turns`) are unaffected — they flow through the
  reporting path and work from any cluster.
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
- FR3: two agents claiming concurrently never receive the same run; a
  human-station or service-node row is never returned by a claim; the
  minikube acceptance walk ends with a PR authored from a locally executed
  station run.
- FR4: killing a satellite mid-run requeues its claim within the offline
  threshold (5 min) plus two reaper cycles (one to mark offline, one to
  requeue), with a `cluster_agent_offline` audit entry; a satellite-claimed
  run in progress is never relaunched by the central reaper's CR-status arm.
- FR5: an event posted with a valid per-agent token lands; the same event
  after token rotation is rejected; no satellite manifest contains
  `LORE_INGEST_TOKEN`.
- FR6: the standalone chart renders in CI with only the documented values;
  a rendered manifest contains no Postgres reference.
- FR7: the cluster list shows a just-registered agent as `active` and flips
  it to `offline` within the offline threshold (5 min) plus one reaper cycle
  after its last heartbeat.
