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
  (`visits.some(v => v.outcome === null)`) is untouched. ([validated by `advance.test.ts:1461`](apps/floor/src/jobs/assembly-run/advance.test.ts#L1461))
- `started_at` keeps its NOT NULL row-creation meaning (now: enqueue time).
  Execution timing moves to the new `claimed_at`: the reaper measures the
  node's `timeout_minutes` budget from `claimed_at`, never from `started_at`,
  so time spent waiting for a capable cluster is not charged against
  execution. ([validated by `assembly-run-reaper.test.ts:137`](apps/floor/src/jobs/assembly-run/assembly-run-reaper.test.ts#L137), [`assembly-run-reaper.test.ts:607`](apps/floor/src/jobs/assembly-run/assembly-run-reaper.test.ts#L723), [`assembly-run-reaper.test.ts:120`](apps/floor/src/jobs/assembly-run/assembly-run-reaper.test.ts#L120))
- A run that sits `queued` longer than a configurable queue-wait bound
  (default 30 minutes) is failed terminally with the existing
  `failure_class` mechanics and a detail naming the unmatched
  `required_tags` — a line stalled because no registered cluster carries a
  tag must say so, not report a generic infra timeout. ([validated by `assembly-run-reaper.test.ts:168`](apps/floor/src/jobs/assembly-run/assembly-run-reaper.test.ts#L168), [`assembly-run-reaper.test.ts:527`](apps/floor/src/jobs/assembly-run/assembly-run-reaper.test.ts#L643), [`assembly-run-reaper.test.ts:417`](apps/floor/src/jobs/assembly-run/assembly-run-reaper.test.ts#L431), [`assembly-run-reaper.test.ts:248`](apps/floor/src/jobs/assembly-run/assembly-run-reaper.test.ts#L248), [`assembly-run-reaper.test.ts:253`](apps/floor/src/jobs/assembly-run/assembly-run-reaper.test.ts#L253), [`assembly-run-reaper.test.ts:162`](apps/floor/src/jobs/assembly-run/assembly-run-reaper.test.ts#L162), [`assembly-run-reaper.test.ts:545`](apps/floor/src/jobs/assembly-run/assembly-run-reaper.test.ts#L661))
- Requeueing (FR4) resets the **same row** back to `queued`, clearing
  `cluster_agent_id` and `claimed_at`. No second row is inserted, so the
  row-id-as-visit-order contract the fork replay depends on
  (`assembly-runs-pg.ts`) sees exactly one row per node visit, claimed or
  not. ([validated by `assembly-run-reaper.test.ts:572`](apps/floor/src/jobs/assembly-run/assembly-run-reaper.test.ts#L688), [`assembly-run-reaper.test.ts:107`](apps/floor/src/jobs/assembly-run/assembly-run-reaper.test.ts#L107), [`assembly-run-reaper.test.ts:95`](apps/floor/src/jobs/assembly-run/assembly-run-reaper.test.ts#L95), [`assembly-runs.contract.test.ts:993`](libs/shared/src/project/assembly-runs/assembly-runs.contract.test.ts#L993))

## FR1 — Cluster-agent registry and identity

A new `pipeline.cluster_agents` table is the registry of execution clusters.

- A cluster-agent registers with `POST /api/cluster-agents/register` on
  lore-api (all `/api/cluster-agents/*` endpoints live in
  `apps/lore-api/src/api/routes/cluster-agents/`), authenticating with a
  pre-shared registration token (`LORE_CLUSTER_AGENT_REGISTRATION_TOKEN`),
  and receives a durable id and a per-agent bearer token. ([validated by `register.test.ts:44`](apps/lore-api/src/api/routes/cluster-agents/register.test.ts#L44), [`register.test.ts:14`](apps/lore-api/src/api/routes/cluster-agents/register.test.ts#L14), [`register.test.ts:31`](apps/lore-api/src/api/routes/cluster-agents/register.test.ts#L31), [`registration.test.ts:129`](apps/cluster-agent/src/claim/registration.test.ts#L115), [`registration.test.ts:162`](apps/cluster-agent/src/claim/registration.test.ts#L148), [`registration.test.ts:84`](apps/cluster-agent/src/claim/registration.test.ts#L83), [`registration.test.ts:183`](apps/cluster-agent/src/claim/registration.test.ts#L169), [`registration.test.ts:252`](apps/cluster-agent/src/claim/registration.test.ts#L238))
- The per-agent token is stored SHA-256-hashed in
  `pipeline.cluster_agents.token_hash`, following the existing
  `pipeline.api_tokens` pattern; every subsequent lore-api call from that
  agent authenticates with it. ([validated by `cluster-agents.test.ts:68`](libs/shared/src/project/cluster-agents/cluster-agents.test.ts#L69), [`cluster-agents.test.ts:76`](libs/shared/src/project/cluster-agents/cluster-agents.test.ts#L77))
- A failed registration attempt is retried on a 30-second schedule doubling
  to a 5-minute cap, and never crashes the process — the agent's other
  duties (the watch, the inbound routes) do not depend on it. ([validated by `registration.test.ts:238`](apps/cluster-agent/src/claim/registration.test.ts#L238), [`registration.test.ts:265`](apps/cluster-agent/src/claim/registration.test.ts#L265))
- "Failed" means every way an attempt can fail, not only a refused HTTP status:
  a 200 carrying an ingress error page, a body without `{id, token}`, and an
  identity Secret the Role can neither read nor write are all answered `null`
  and retried. A throw here has no catch above it — `pollUntil` ends, the boot
  registrant dies, and the pod goes on answering `/healthz` 200 while claiming
  nothing; through the shared re-registration the same throw ends the claim
  loop, the heartbeat loop or the proxy's drain instead. ([validated by `registration.test.ts:307`](apps/cluster-agent/src/claim/registration.test.ts#L307), [`registration.test.ts:321`](apps/cluster-agent/src/claim/registration.test.ts#L321), [`registration.test.ts:329`](apps/cluster-agent/src/claim/registration.test.ts#L329), [`registration.test.ts:340`](apps/cluster-agent/src/claim/registration.test.ts#L340), [`registration.test.ts:361`](apps/cluster-agent/src/claim/registration.test.ts#L361))
- Which identity store to use is decided at boot, beside the registration
  triple: a Secret named without its namespace refuses to start, naming the
  variable. Resolved later — inside the registrant's promise — the same
  misconfiguration was one log line behind a green probe, which is the
  unregistered mode the refusal above exists to abolish. ([validated by chooses the file store when no identity Secret is named](apps/cluster-agent/src/claim/identity-store.test.ts#L90), [`identity-store.test.ts:96`](apps/cluster-agent/src/claim/identity-store.test.ts#L96), [`identity-store.test.ts:110`](apps/cluster-agent/src/claim/identity-store.test.ts#L110), [`identity-store.test.ts:120`](apps/cluster-agent/src/claim/identity-store.test.ts#L120))
- Registration is idempotent on `name` — but only for the identity holder:
  re-registering an existing name **with the current per-agent bearer token**
  updates `tags` and `cluster_info` and **keeps that token**. Re-registering a
  known name without it is rejected `409` — the shared registration token
  alone must never suffice to take over a live cluster's identity.
  *(2026-08-29: this used to MINT a new token. That made every restart of a
  cluster-agent cut off its own running pods — the credential is published into
  `agent-secrets` at registration and a run pod reads it exactly once, at
  creation, so a rollout silently 401'd every in-flight run's telemetry for the
  rest of its life. The rotation bought no recovery either: a token that does
  not match is rejected `409` either way, so the only case that rotated was the
  one that needed no new token at all.)* ([validated by `register.test.ts:67`](apps/lore-api/src/api/routes/cluster-agents/register.test.ts#L67), [`register.test.ts:93`](apps/lore-api/src/api/routes/cluster-agents/register.test.ts#L93), [`cluster-agents.test.ts:43`](libs/shared/src/project/cluster-agents/cluster-agents.test.ts#L43), [`cluster-agents.test.ts:47`](libs/shared/src/project/cluster-agents/cluster-agents.test.ts#L47), [`cluster-agents.test.ts:56`](libs/shared/src/project/cluster-agents/cluster-agents.test.ts#L57), [`cluster-agents.test.ts:60`](libs/shared/src/project/cluster-agents/cluster-agents.test.ts#L61), [`registration.test.ts:175`](apps/cluster-agent/src/claim/registration.test.ts#L161))
- Two concurrent first registrations of the same name resolve to one
  identity: the insert is conflict-safe, and the loser receives the same
  `409` as any other taken name — never a 500. ([validated by `register.test.ts:122`](apps/lore-api/src/api/routes/cluster-agents/register.test.ts#L122), [`cluster-agents.test.ts:118`](libs/shared/src/project/cluster-agents/cluster-agents.test.ts#L119))
- Credential handling is uniform across the cluster-agent endpoints: the
  `Authorization` header is parsed by the shared `extractBearer` — anchored
  to the start, scheme case-insensitive per RFC 7235, first value of a
  multi-value header — and secrets (registration token, token hashes) are
  compared constant-time via the shared `secretEquals`. ([validated by `bearer.test.ts:5`](libs/shared/src/http/bearer.test.ts#L5), [`bearer.test.ts:9`](libs/shared/src/http/bearer.test.ts#L9), [`bearer.test.ts:14`](libs/shared/src/http/bearer.test.ts#L14), [`bearer.test.ts:18`](libs/shared/src/http/bearer.test.ts#L18), [`bearer.test.ts:28`](libs/shared/src/http/bearer.test.ts#L28))
- The satellite persists its identity (`{id, token}`) in the Kubernetes
  Secret `lore-cluster-agent-identity`, written through the Kubernetes API
  (the chart's container is `readOnlyRootFilesystem` and the Secret mount is
  read-only, so a file write could never persist it) — so pod restarts do
  not re-register; re-registration presents the persisted token. Local runs
  keep the file store at `LORE_CLUSTER_AGENT_IDENTITY_FILE`. ([validated by `kube-identity-store.test.ts:37`](apps/cluster-agent/src/claim/kube-identity-store.test.ts#L37), [`kube-identity-store.test.ts:41`](apps/cluster-agent/src/claim/kube-identity-store.test.ts#L41), [`kube-identity-store.test.ts:51`](apps/cluster-agent/src/claim/kube-identity-store.test.ts#L51), [`kube-identity-store.test.ts:64`](apps/cluster-agent/src/claim/kube-identity-store.test.ts#L64), [`identity-store.test.ts:40`](apps/cluster-agent/src/claim/identity-store.test.ts#L40), [`identity-store.test.ts:16`](apps/cluster-agent/src/claim/identity-store.test.ts#L16), [`identity-store.test.ts:25`](apps/cluster-agent/src/claim/identity-store.test.ts#L25), [`identity-store.test.ts:33`](apps/cluster-agent/src/claim/identity-store.test.ts#L33), [`identity-store.test.ts:49`](apps/cluster-agent/src/claim/identity-store.test.ts#L49), [`identity-store.test.ts:60`](apps/cluster-agent/src/claim/identity-store.test.ts#L60), [`identity-store.test.ts:69`](apps/cluster-agent/src/claim/identity-store.test.ts#L69), [`identity-store.test.ts:80`](apps/cluster-agent/src/claim/identity-store.test.ts#L80), [`registration.test.ts:149`](apps/cluster-agent/src/claim/registration.test.ts#L135))
- The registry ships as the next migration in sequence
  (`NNNN_cluster_agent_registry.sql`) under
  `infra/terraform/modules/gke-mcp/lore-platform/charts/ui-helm/migrations/`:
  the table plus columns `status`, `cluster_agent_id`, `required_tags`,
  `claimed_at` on `pipeline.station_runs`.
- A `ClusterAgent` Zod model in `libs/shared/src/models/` and a
  port + Pg adapter + InMemory double under
  `libs/shared/src/project/cluster-agents/` follow the house pattern. ([validated by `cluster-agents.test.ts:93`](libs/shared/src/project/cluster-agents/cluster-agents.test.ts#L94), [`cluster-agents.test.ts:140`](libs/shared/src/project/cluster-agents/cluster-agents.test.ts#L140), [`cluster-agents.test.ts:248`](libs/shared/src/project/cluster-agents/cluster-agents.test.ts#L249), [`cluster-agents.test.ts:269`](libs/shared/src/project/cluster-agents/cluster-agents.test.ts#L270), [`cluster-agents.test.ts:293`](libs/shared/src/project/cluster-agents/cluster-agents.test.ts#L293))

## FR2 — Capability tags

Capabilities are a flat tag set, matched by inclusion — no scheduler, no
scoring.

- A cluster-agent declares `tags: text[]` at registration (for example
  `["node:agent", "node:validate", "gpu"]`). ([validated by `register.test.ts:44`](apps/lore-api/src/api/routes/cluster-agents/register.test.ts#L44), [`registration.test.ts:95`](apps/cluster-agent/src/claim/registration.test.ts#L94), [`registration.test.ts:103`](apps/cluster-agent/src/claim/registration.test.ts#L102), [`registration.test.ts:75`](apps/cluster-agent/src/claim/registration.test.ts#L74))
- Every station run carries `required_tags: text[]`; a cluster-agent may
  claim a run only when `required_tags <@ tags`. The node type's own tag
  (`node:<type>`) is ALWAYS required — a run is claimable only by an agent
  declaring capability for that node type, which is what keeps central-only
  workloads central: ingest pods mount `LORE_INGEST_TOKEN`, which never
  ships to satellites, so satellites simply never register `node:ingest`
  (the first registered satellite legally drained the production ingest
  queue into pods that could never start, #1576). ([validated by `required-tags.test.ts:9`](libs/shared/src/project/cluster-agents/required-tags.test.ts#L9), [`required-tags.test.ts:15`](libs/shared/src/project/cluster-agents/required-tags.test.ts#L15), [`required-tags.test.ts:26`](libs/shared/src/project/cluster-agents/required-tags.test.ts#L26), [`advance.test.ts:1494`](apps/floor/src/jobs/assembly-run/advance.test.ts#L1494))
- Assembly-line YAML nodes accept an optional `required_tags` list in the
  loader schema, added ON TOP of the type tag; an absent list inherits the
  repo-level default `settings.station_default_tags`, and an absent default
  adds nothing beyond the type tag. The default is applied at enqueue time,
  never baked into the parsed definition, so it stays out of
  `definitionHash`. ([validated by `required-tags.test.ts:49`](libs/shared/src/project/cluster-agents/required-tags.test.ts#L49), [`required-tags.test.ts:63`](libs/shared/src/project/cluster-agents/required-tags.test.ts#L63), [validated by `loader.test.ts:1027`](libs/assembly-lines/src/loader.test.ts#L1027), [`loader.test.ts:1045`](libs/assembly-lines/src/loader.test.ts#L1045), [`loader.test.ts:1053`](libs/assembly-lines/src/loader.test.ts#L1053), [`snapshot-graph.test.ts:91`](libs/assembly-lines/src/snapshot-graph.test.ts#L91), [`advance.test.ts:1521`](apps/floor/src/jobs/assembly-run/advance.test.ts#L1521), [`required-tags.test.ts:33`](libs/shared/src/project/cluster-agents/required-tags.test.ts#L33), [`required-tags.test.ts:41`](libs/shared/src/project/cluster-agents/required-tags.test.ts#L41), [`required-tags.test.ts:49`](libs/shared/src/project/cluster-agents/required-tags.test.ts#L49))
- Only a run whose stored `required_tags` are `{}` (rows enqueued before the
  type-tag invariant) is claimable by every registered cluster-agent. ([validated by `required-tags.test.ts:19`](libs/shared/src/project/cluster-agents/required-tags.test.ts#L19))

## FR3 — Claim-based dispatch

Dispatch flips from push to pull, because a minikube or customer cluster is
unreachable for inbound calls — the defining constraint of the GitLab Runner
model. The central cluster's agent claims through the same path, so there is
one dispatch mechanism, not a special case plus a remote case.

- The Floor's launch seam writes the station run as `queued`, carrying the
  complete dispatch spec (node type, target repo, branch, args, conversation,
  timeout) instead of calling the cluster-agent directly. Only nodes that
  reach the launch seam are enqueued — human-station and service-node rows
  never become `queued` and are therefore never claimable. Arming is
  queued-only: a row another cluster has already claimed was handed its spec
  with the claim, so re-arming it would leave the row describing something
  other than the pod being built from it. ([validated by arming a claimed row is a no-op, so a re-dispatch cannot rewrite what a pod is being built from](libs/shared/src/project/assembly-runs/assembly-runs.contract.test.ts#L1068), [`advance.test.ts:1461`](apps/floor/src/jobs/assembly-run/advance.test.ts#L1461), [`advance.test.ts:1549`](apps/floor/src/jobs/assembly-run/advance.test.ts#L1549), [`advance.test.ts:1562`](apps/floor/src/jobs/assembly-run/advance.test.ts#L1562), [`advance.test.ts:1589`](apps/floor/src/jobs/assembly-run/advance.test.ts#L1589))
- A cluster-agent polls `POST /api/cluster-agents/{id}/claim` on a
  configurable interval (default 15 s); the claim is a single
  `SELECT … FOR UPDATE SKIP LOCKED` CTE that sets `status = 'claimed'`,
  `cluster_agent_id`, and `claimed_at` in one statement, so concurrent
  claimants are safe. ([validated by `claim.test.ts:110`](apps/lore-api/src/api/routes/cluster-agents/claim.test.ts#L110), [`assembly-runs.contract.test.ts:901`](libs/shared/src/project/assembly-runs/assembly-runs.contract.test.ts#L901), [`assembly-runs.contract.test.ts:961`](libs/shared/src/project/assembly-runs/assembly-runs.contract.test.ts#L961))
- The central cluster runs the same claim loop: cluster-agent-helm registers
  it as `central` — the name the Floor reaper resolves CR visibility by —
  with the full tag set, including the central-only tags satellites never
  receive. The flip to pull-based dispatch means a central deployment
  WITHOUT a registered claimant leaves every queued run to die at the
  queue-wait bound (observed live, 2026-08-26).
- Registration is therefore not a mode, and a cluster-agent refuses to boot
  without `LORE_API_URL`, `LORE_CLUSTER_AGENT_REGISTRATION_TOKEN` and
  `LORE_CLUSTER_AGENT_NAME` rather than serving its read routes while
  claiming nothing. The refusal names every missing variable at once, because
  an operator who learns one name per restart restarts once per name.
  *(2026-08-29: the `claim.enabled` chart flag and the
  `enable_cluster_agent_registration` terraform gate are deleted with it —
  a flag whose false value is a silently broken factory is not a choice.)*
  ([validated by refuses to boot when LORE_API_URL is unset, naming it](apps/cluster-agent/src/claim/registration.test.ts#L45), [`registration.test.ts:52`](apps/cluster-agent/src/claim/registration.test.ts#L51), [`registration.test.ts:61`](apps/cluster-agent/src/claim/registration.test.ts#L60), [`registration.test.ts:67`](apps/cluster-agent/src/claim/registration.test.ts#L66))
- A claim the agent then fails to LAUNCH is handed back:
  `POST /api/cluster-agents/{id}/release` requeues that visit on the same row,
  naming the cause. The claim CASes the row to `claimed` before any pod exists,
  so a launch that throws — a recipe the catalog does not hold, a mint refused,
  a Secret write that lost its race — leaves a claimed row with nothing behind
  it. Unsaid, that row waits: centrally for the reaper to notice a missing CR,
  and on a satellite, whose CRs the centre cannot see, for the whole node
  budget. It requeues rather than fails because the cause is usually about the
  cluster that claimed, and another may launch it; a row that keeps coming back
  is for the queue-wait bound to end. ([validated by requeues the visit a claimant could not launch](apps/lore-api/src/api/routes/cluster-agents/release.test.ts#L39), [`release.test.ts:52`](apps/lore-api/src/api/routes/cluster-agents/release.test.ts#L52), [`release.test.ts:65`](apps/lore-api/src/api/routes/cluster-agents/release.test.ts#L65), [`release.test.ts:73`](apps/lore-api/src/api/routes/cluster-agents/release.test.ts#L73), [`release.test.ts:87`](apps/lore-api/src/api/routes/cluster-agents/release.test.ts#L87), [hands the visit back under the per-agent token, naming the cause](apps/cluster-agent/src/claim/claim-loop.test.ts#L303), [`claim-loop.test.ts:327`](apps/cluster-agent/src/claim/claim-loop.test.ts#L327))
- A claim whose CR ALREADY EXISTS is not a fresh launch. A requeued visit
  converges on the name its previous attempt used, and that attempt's CR may
  still be standing — its terminal event has already been consumed, so nothing
  further will settle the row. The claimant reports the two apart rather than
  logging a launch that did not happen. ([validated by reports already-running when the CR was already there](apps/cluster-agent/src/claim/claim-loop.test.ts#L197))
- Shutdown stops claiming before it waits for anything else. A claim that lands
  during the drain is a visit recorded as claimed by an agent whose launch —
  mint, Secret write, catalog clone, CR create — `process.exit` then cuts in the
  middle, on every rollout, and the queue is busiest exactly when rollouts hurt. ([validated by keeps running until stopped](apps/cluster-agent/src/claim/claim-loop.test.ts#L344), [`claim-loop.test.ts:352`](apps/cluster-agent/src/claim/claim-loop.test.ts#L352))
- Claim and heartbeat calls authenticate with the per-agent bearer token
  issued at registration, like every other lore-api call the agent makes. ([validated by `claim.test.ts:50`](apps/lore-api/src/api/routes/cluster-agents/claim.test.ts#L50), [`claim.test.ts:60`](apps/lore-api/src/api/routes/cluster-agents/claim.test.ts#L60), [`claim.test.ts:69`](apps/lore-api/src/api/routes/cluster-agents/claim.test.ts#L69), [`claim-loop.test.ts:119`](apps/cluster-agent/src/claim/claim-loop.test.ts#L121), [`claim-loop.test.ts:164`](apps/cluster-agent/src/claim/claim-loop.test.ts#L166), [`claim-loop.test.ts:170`](apps/cluster-agent/src/claim/claim-loop.test.ts#L172), [`claim-loop.test.ts:244`](apps/cluster-agent/src/claim/claim-loop.test.ts#L280))
- A claim request with no matching queued run returns `204`. An idle agent
  backs its polling off (doubling to a 60 s ceiling, resetting on the first
  hit), so a fleet of quiet satellites costs the API a bounded trickle
  rather than O(N) at the floor interval. ([validated by `claim.test.ts:78`](apps/lore-api/src/api/routes/cluster-agents/claim.test.ts#L78), [`claim.test.ts:136`](apps/lore-api/src/api/routes/cluster-agents/claim.test.ts#L136), [`claim-loop.test.ts:59`](apps/cluster-agent/src/claim/claim-loop.test.ts#L61), [`claim-loop.test.ts:63`](apps/cluster-agent/src/claim/claim-loop.test.ts#L65), [`claim-loop.test.ts:69`](apps/cluster-agent/src/claim/claim-loop.test.ts#L71), [`claim-loop.test.ts:77`](apps/cluster-agent/src/claim/claim-loop.test.ts#L79), [`claim-loop.test.ts:84`](apps/cluster-agent/src/claim/claim-loop.test.ts#L86), [`claim-loop.test.ts:88`](apps/cluster-agent/src/claim/claim-loop.test.ts#L90), [`claim-loop.test.ts:133`](apps/cluster-agent/src/claim/claim-loop.test.ts#L135), [`claim-loop.test.ts:230`](apps/cluster-agent/src/claim/claim-loop.test.ts#L266))
- The claim response carries the **complete `LoreTaskSpec`** the visit was
  enqueued with — the same object the push path handed the launch backend.
  The claiming cluster-agent materialises everything cluster-local itself:
  the builtin `def-<type>` catalog arrives with the ai-agents subchart it is
  installed beside, per-task token provisioning and the AgentDefinition +
  Station clone happen through its own provisioner, no context is fetched at
  dispatch by either cluster (removed 2026-08-28 — the credential it needed
  never leaves central, so it was the last thing that made a central run and a
  satellite run of one recipe differ; agent pods assemble their own through the
  live lore-mcp gateway), and the Agent CR is created under the exact CR name
  the Floor recorded on the station-run row — so no synced catalog is
  required and no inbound push ever occurs. ([validated by `claim-loop.test.ts:139`](apps/cluster-agent/src/claim/claim-loop.test.ts#L141), [`claim-loop.test.ts:152`](apps/cluster-agent/src/claim/claim-loop.test.ts#L154), [`claim-loop.test.ts:178`](apps/cluster-agent/src/claim/claim-loop.test.ts#L178), [`claim-loop.test.ts:187`](apps/cluster-agent/src/claim/claim-loop.test.ts#L209), [`claim-loop.test.ts:194`](apps/cluster-agent/src/claim/claim-loop.test.ts#L216), [`claim-loop.test.ts:253`](apps/cluster-agent/src/claim/claim-loop.test.ts#L289), [`claim-loop.test.ts:200`](apps/cluster-agent/src/claim/claim-loop.test.ts#L222))
- Outcome reporting rides the existing path: the cluster-agent's watch
  reports terminal phases through the event-router front door with dedupe
  keys, and the central Floor's event loop advances the assembly line
  without knowing which cluster executed the node.
- **The Floor settles a terminal run from the REPORT, never by reading the
  cluster back** *(2026-08-29)*. This holds for a single-CR task exactly as it
  does for a node: the `kubernetes.agent.*` handler used to re-GET the CR
  through the one `CLUSTER_AGENT_URL` it knows, which made settling conditional
  on reaching the cluster that ran the pod — and a CR read in the wrong cluster
  answers `found:false` indistinguishably from "no such CR". The event already
  carries the full status, so nothing is fetched; params that do not describe a
  terminal run settle nothing rather than defaulting.
  ([validated by settles the run from the event's own report, with no cluster read](apps/floor/src/jobs/kubernetes.test.ts#L30), [`kubernetes.test.ts:42`](apps/floor/src/jobs/kubernetes.test.ts#L42), [`kubernetes.test.ts:58`](apps/floor/src/jobs/kubernetes.test.ts#L58), [`kubernetes.test.ts:64`](apps/floor/src/jobs/kubernetes.test.ts#L64), [`agent-watcher-logic.test.ts:236`](apps/floor/src/jobs/watcher/agent-watcher-logic.test.ts#L236), [`agent-watcher-logic.test.ts:257`](apps/floor/src/jobs/watcher/agent-watcher-logic.test.ts#L257), [`agent-watcher-logic.test.ts:261`](apps/floor/src/jobs/watcher/agent-watcher-logic.test.ts#L261), [`agent-watcher-logic.test.ts:265`](apps/floor/src/jobs/watcher/agent-watcher-logic.test.ts#L265), [`agent-watcher-logic.test.ts:277`](apps/floor/src/jobs/watcher/agent-watcher-logic.test.ts#L277))
- What the run was dispatched WITH is recovered from what the Floor wrote down —
  the run row first (it recorded the repo, branch and description at dispatch),
  then the backing task, preferring the branch dispatch actually used. These
  were read off `Agent.spec`, the one copy that exists only in the executing
  cluster and only until the prune.
  ([validated by reads what the run row recorded at dispatch, not what a cluster still holds](apps/floor/src/jobs/watcher/agent-watcher-logic.test.ts#L308), [`agent-watcher-logic.test.ts:333`](apps/floor/src/jobs/watcher/agent-watcher-logic.test.ts#L333), [`agent-watcher-logic.test.ts:351`](apps/floor/src/jobs/watcher/agent-watcher-logic.test.ts#L351), [`agent-watcher-logic.test.ts:363`](apps/floor/src/jobs/watcher/agent-watcher-logic.test.ts#L363), [`agent-watcher-logic.test.ts:377`](apps/floor/src/jobs/watcher/agent-watcher-logic.test.ts#L377), [`agent-watcher-logic.test.ts:317`](apps/floor/src/jobs/watcher/agent-watcher-logic.test.ts#L317))

## FR4 — Liveness, recovery, and dead-agent reaping

Recovery today assumes the reaper can interrogate the Agent CR — a pull
against the central cluster-agent. A satellite's CRs are invisible to that
pull, so recovery splits by who holds the claim:

- A cluster-agent posts `POST /api/cluster-agents/{id}/heartbeat` every 30 s,
  bumping `last_seen_at`. ([validated by `cluster-agents.test.ts:166`](libs/shared/src/project/cluster-agents/cluster-agents.test.ts#L167), [`cluster-agents.test.ts:331`](libs/shared/src/project/cluster-agents/cluster-agents.test.ts#L332), [`heartbeat.test.ts:22`](apps/lore-api/src/api/routes/cluster-agents/heartbeat.test.ts#L22), [`heartbeat.test.ts:38`](apps/lore-api/src/api/routes/cluster-agents/heartbeat.test.ts#L38), [`heartbeat-loop.test.ts:29`](apps/cluster-agent/src/claim/heartbeat-loop.test.ts#L29), [`heartbeat-loop.test.ts:33`](apps/cluster-agent/src/claim/heartbeat-loop.test.ts#L33), [`heartbeat-loop.test.ts:44`](apps/cluster-agent/src/claim/heartbeat-loop.test.ts#L44), [`heartbeat-loop.test.ts:74`](apps/cluster-agent/src/claim/heartbeat-loop.test.ts#L86), [`heartbeat-loop.test.ts:62`](apps/cluster-agent/src/claim/heartbeat-loop.test.ts#L62))
- The assembly-run reaper (existing cadence) marks cluster-agents with
  `last_seen_at < now() - 5 minutes` as `offline` — ten missed heartbeats,
  so a transient network blip or one dropped request never requeues live
  work. ([validated by `cluster-agents.test.ts:218`](libs/shared/src/project/cluster-agents/cluster-agents.test.ts#L219), [`cluster-agents.test.ts:308`](libs/shared/src/project/cluster-agents/cluster-agents.test.ts#L309), [`assembly-run-reaper.test.ts:795`](apps/floor/src/jobs/assembly-run/assembly-run-reaper.test.ts#L911))
- The reaper's CR-status recovery arm (`readAgentStatus` → relaunch on null)
  applies **only** to runs claimed by the central cluster's agent — the one
  cluster `CLUSTER_AGENT_URL` can reach. For satellite-claimed runs that arm
  is skipped entirely; their recovery signal is the claiming agent's
  liveness, never a CR read that would come back null and trigger a
  duplicate central launch. ([validated by `assembly-run-reaper.test.ts:174`](apps/floor/src/jobs/assembly-run/assembly-run-reaper.test.ts#L174), [`assembly-run-reaper.test.ts:189`](apps/floor/src/jobs/assembly-run/assembly-run-reaper.test.ts#L189), [`assembly-run-reaper.test.ts:556`](apps/floor/src/jobs/assembly-run/assembly-run-reaper.test.ts#L672), [`cr-visibility.test.ts:8`](apps/floor/src/jobs/assembly-run/cr-visibility.test.ts#L8), [`cr-visibility.test.ts:14`](apps/floor/src/jobs/assembly-run/cr-visibility.test.ts#L14), [`cr-visibility.test.ts:23`](apps/floor/src/jobs/assembly-run/cr-visibility.test.ts#L23), [`cr-visibility.test.ts:32`](apps/floor/src/jobs/assembly-run/cr-visibility.test.ts#L32), [`cr-visibility.test.ts:38`](apps/floor/src/jobs/assembly-run/cr-visibility.test.ts#L38))
- The same restriction binds the **terminal-event door**, not only the reaper:
  it MUST NOT read a satellite-claimed run's CR back, and MUST NOT treat the
  null it would get as an empty output — this is the fallback path, taken
  only when the event carries no status of its own. ([validated by `code-review-acceptance.test.ts:26`](apps/floor/src/jobs/assembly-run/code-review-acceptance.test.ts#L26), [`code-review-acceptance.test.ts:38`](apps/floor/src/jobs/assembly-run/code-review-acceptance.test.ts#L38), [`code-review-acceptance.test.ts:53`](apps/floor/src/jobs/assembly-run/code-review-acceptance.test.ts#L53))
- The follow-up this restriction always pointed at: the terminal event MAY
  carry the CR's status directly (`params.status`, reported by cluster-agent
  at the source — the same `AgentNodeStatus` `statusFromAgentCr` builds for
  the central cluster-agent's own status route). When it does, the terminal
  door uses it as-is and skips the central read and the visibility gate
  entirely — there is nothing left to interrogate a cluster for. This is what
  makes a satellite's outcome reach the Floor for real instead of stalling
  open until the reaper eventually times it out, discarding whatever the
  agent actually produced. An event from an older, not-yet-redeployed
  cluster-agent carries no `status` and falls straight back to the restriction
  above — this is additive, not a replacement, and rolls out in either
  direction with no coordination required. ([validated by `k8s-map.test.ts:76`](libs/shared/src/project/events/k8s-map.test.ts#L76), [`k8s-map.test.ts:90`](libs/shared/src/project/events/k8s-map.test.ts#L90), [`node-event-handler.test.ts:360`](apps/floor/src/jobs/assembly-run/node-event-handler.test.ts#L360), [`node-event-handler.test.ts:378`](apps/floor/src/jobs/assembly-run/node-event-handler.test.ts#L378), [`code-review-acceptance.test.ts:62`](apps/floor/src/jobs/assembly-run/code-review-acceptance.test.ts#L62), [`code-review-acceptance.test.ts:77`](apps/floor/src/jobs/assembly-run/code-review-acceptance.test.ts#L77))

- A run claimed by an **offline** agent is reset to `queued` (same row, per
  the lifecycle section); the reaper — the same process that set the agent
  `offline` — writes a `cluster_agent_offline` entry to `pipeline.audit_log`
  recording the `cluster_agent_id`, the `station_run_id`, and the elapsed
  time since `claimed_at`, so another agent picks the run up and the outage
  is attributable. Re-execution resumes on the run's existing branch —
  branch-as-state already makes a node re-run land on whatever commits the
  dead attempt pushed. ([validated by `assembly-run-reaper.test.ts:795`](apps/floor/src/jobs/assembly-run/assembly-run-reaper.test.ts#L909), [`assembly-run-reaper.test.ts:763`](apps/floor/src/jobs/assembly-run/assembly-run-reaper.test.ts#L879), [`assembly-run-reaper.test.ts:777`](apps/floor/src/jobs/assembly-run/assembly-run-reaper.test.ts#L893), [`assembly-run-reaper.test.ts:855`](apps/floor/src/jobs/assembly-run/assembly-run-reaper.test.ts#L971))
- A run whose claiming agent is **alive** but which exceeds its node timeout
  (measured from `claimed_at`) is failed terminally, exactly the reaper's
  timeout semantics today — a live agent past budget is a stuck node, not a
  lost one, and requeueing it would double-execute its side effects.
- A returning agent re-registers under its persisted identity and resumes
  claiming; its stale claims have already been requeued, and dedupe keys make
  any late duplicate report safe. ([validated by `heartbeat-loop.test.ts:100`](apps/cluster-agent/src/claim/heartbeat-loop.test.ts#L112), [`heartbeat-loop.test.ts:62`](apps/cluster-agent/src/claim/heartbeat-loop.test.ts#L74), [`assembly-runs.contract.test.ts:1099`](libs/shared/src/project/assembly-runs/assembly-runs.contract.test.ts#L1137))

## FR5 — Reporting credentials for satellites

A satellite must report outcomes without holding the bus-wide credential.

- The event-router's `POST /api/events` accepts, in addition to
  `LORE_INGEST_TOKEN`, per-agent bearer tokens verified against
  `pipeline.cluster_agents.token_hash` (the router already holds the pool;
  this is a lookup, not a new dependency). ([validated by [`reporter-auth.test.ts:66`](apps/event-router/src/delivery/routes/reporter-auth.test.ts#L66), [`reporter-auth.test.ts:102`](apps/event-router/src/delivery/routes/reporter-auth.test.ts#L102), [`reporter-auth.test.ts:112`](apps/event-router/src/delivery/routes/reporter-auth.test.ts#L112))
- Satellites report with their per-agent token; `LORE_INGEST_TOKEN` never
  leaves the central cluster — and a per-agent token authorises the
  reporting front door only, never the router's other surfaces. The
  satellite's reporter RESOLVES that token per call rather than capturing it:
  a re-registration rotates it, and a captured value would 401 every report
  from then on — which is what the watch did silently until the credential
  was wired at all, leaving every node to the reaper instead. ([validated by [`server-auth.test.ts:39`](apps/event-router/src/delivery/server-auth.test.ts#L39), [`event-reporter-http.test.ts:66`](libs/shared/src/project/events/event-reporter-http.test.ts#L66), [`event-reporter-http.test.ts:96`](libs/shared/src/project/events/event-reporter-http.test.ts#L96))
- A report the router REFUSES (401/403) re-registers before it retries, via
  the same single-flight re-registration the claim and heartbeat loops share
  *(2026-08-28)*: the token rotates whenever another instance of this
  satellite registers, and retrying with the rotated-out token five times lost
  run 595d2b0b's terminal event — the node sat open with nothing central able
  to see its CR. The reporter names the status on its refusal so the watch can
  tell a rotation from a blip. And the overlap itself is closed at the source:
  both cluster-agent Deployments roll out `Recreate`, since a singleton
  registrant that overlaps its own successor rotates the successor's token.
  ([validated by re-registers once on a refused credential and the retry then lands](libs/shared/src/project/events/event-proxy.test.ts#L169), [`event-reporter-http.test.ts:119`](libs/shared/src/project/events/event-reporter-http.test.ts#L119), [`check-cluster-agent-standalone-render.sh`](scripts/check-cluster-agent-standalone-render.sh#L1))
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
- The seeded catalog's http telemetry sink (`agent-events-auth`, a bus-wide
  `LORE_AGENT_INTERNAL_TOKEN`-backed credential every recipe declares) is
  guarded behind `.Values.agentEventsUrl`: the standalone chart leaves it
  unset, so the sink is omitted from every recipe entirely rather than
  rendered pointed at an unreachable URL with a secret no satellite can
  hold. Unguarded, this was a hard `CreateContainerConfigError` on every
  satellite pod, of every node type — the first real satellite's every
  claimed run failed at init (#1575, found live 2026-08-26). Unset stays the
  default: a satellite reports its terminal outcome and nothing live, which
  is the honest state for a cluster with nowhere to report to. ([validated by `agent-catalog.test.ts:202`](apps/floor/src/jobs/agent/agent-catalog.test.ts#L202))
- The installer's default tags advertise `node:agent` only *(2026-08-28)*.
  Every seeded station recipe (`def-validate`, `def-gate`, `def-detect`,
  `def-comment-triage`) mounts `LORE_INGEST_TOKEN`, which FR5 keeps on the
  central cluster, so a satellite advertising `node:validate` claims the node
  and dies at init with `CreateContainerConfigError` — the claim and the run
  are wasted (found live on run 595d2b0b: `implement` succeeded on the
  satellite, `validate` never started). Central claims station nodes; an
  operator who overrides `--tags` with a station type owns that credential
  gap. Giving satellites a scoped station credential is a separate FR.

## FR8 — Live telemetry from a satellite

A satellite that reports only terminal outcomes is invisible while it works:
no cost rows, no run view. The credential it already holds is enough to fix
that.

- The Floor's `POST /api/agent-events` accepts TWO credentials, exactly as
  the event-router's `POST /api/events` does (FR5): the bus-wide
  `LORE_AGENT_INTERNAL_TOKEN`, or any registered cluster-agent's per-agent
  token, matched by SHA-256 against `pipeline.cluster_agents`. The shared
  token is compared first, so the central cluster's own calls cost no SELECT;
  agent `status` is deliberately not checked, since a cluster that has gone
  quiet is still the sender of what it is delivering. The rule is one shared
  function both doors call — two front doors disagreeing about who a
  satellite is would only surface in production. ([validated by `registry-or-shared-token.test.ts:51`](libs/shared/src/http/registry-or-shared-token.test.ts#L51), [`registry-or-shared-token.test.ts:64`](libs/shared/src/http/registry-or-shared-token.test.ts#L64), [`registry-or-shared-token.test.ts:77`](libs/shared/src/http/registry-or-shared-token.test.ts#L77), [`registry-or-shared-token.test.ts:91`](libs/shared/src/http/registry-or-shared-token.test.ts#L91), [`registry-or-shared-token.test.ts:134`](libs/shared/src/http/registry-or-shared-token.test.ts#L134), [`agent-events.test.ts:113`](apps/floor/src/delivery/http/routes/agent-events.test.ts#L113), [`agent-events.test.ts:130`](apps/floor/src/delivery/http/routes/agent-events.test.ts#L130))
- The check runs inside the handler rather than as a hapi auth strategy,
  because a strategy holds exactly one expected token. An unconfigured shared
  token is therefore a `500`, not a `401` — an operator redeploys to fix it,
  no caller can — and the refusal names the env var that door actually reads
  rather than the ingest token every other door uses. ([validated by `agent-events.test.ts:97`](apps/floor/src/delivery/http/routes/agent-events.test.ts#L97), [`registry-or-shared-token.test.ts:99`](libs/shared/src/http/registry-or-shared-token.test.ts#L99), [`registry-or-shared-token.test.ts:117`](libs/shared/src/http/registry-or-shared-token.test.ts#L117))
- The satellite publishes its own per-agent token into `agent-secrets` under
  the `agent-events-auth` key the seeded recipes name, as the whole
  `Authorization: Bearer <token>` line the subsystem sends verbatim. It is
  written after EVERY successful registration, not only the first: a rotation
  mints a new token, and the pods' copy must never outlive it. A write
  failure is logged and swallowed — telemetry is not worth failing a
  registration over. ([validated by `agent-events-secret.test.ts:25`](apps/cluster-agent/src/claim/agent-events-secret.test.ts#L26), [`agent-events-secret.test.ts:35`](apps/cluster-agent/src/claim/agent-events-secret.test.ts#L36), [`agent-events-secret.test.ts:49`](apps/cluster-agent/src/claim/agent-events-secret.test.ts#L50), [`registration.test.ts:195`](apps/cluster-agent/src/claim/registration.test.ts#L181), [`registration.test.ts:213`](apps/cluster-agent/src/claim/registration.test.ts#L199), [`registration.test.ts:234`](apps/cluster-agent/src/claim/registration.test.ts#L220))
- The SATELLITE publishes it; a cluster inside the platform does not. There ESO
  templates the same key from `LORE_AGENT_INTERNAL_TOKEN` and rewrites it every
  hour, so an agent writing it too makes two writers of one key, alternating,
  with run pods carrying whichever landed before they started. Holding the
  bus-wide token is what says which cluster this is. ([validated by `agent-events-secret.test.ts:67`](apps/cluster-agent/src/claim/agent-events-secret.test.ts#L68), [`agent-events-secret.test.ts:71`](apps/cluster-agent/src/claim/agent-events-secret.test.ts#L72))
- The sink is reachable through its own ingress (`lore-agent-events.tf`,
  gated on `lore_agent_events_hostname`), not another path on the Floor's
  webhook door: that one carries GitHub's HMAC-verified control-plane
  traffic, this is data-plane telemetry from different callers with a
  different credential. It carries the platform's only ingress-level rate
  limit (`limit-rps`), deliberately a different mechanism from lore-api's
  in-app sliding window (ADR-033) — the Floor has no such plugin, and a newly
  public door should not wait for one.
- Opting in is per satellite and off by default: `agentEventsUrl` on the
  standalone chart (`--telemetry-url` on the installer) sets both the chart's
  own value and the subchart's, since Helm threads neither into the other.
  Unset renders no sink at all, which is FR6's guard doing its job. ([validated by `check-cluster-agent-standalone-render.sh`](scripts/check-cluster-agent-standalone-render.sh#L1))
- A GitHub credential for the cluster-agent's per-task token provisioner is
  optional and chart-managed: `github.token` (a PAT) or the
  `github.app.appId`/`privateKey`/`installationId` triple, mirroring the
  `llm` credential pattern. Absent, registration/claim/heartbeat and
  tag-only stations (`validate`, `gate`, `detect`, `comment-triage`) work
  normally; a claimed run needing a git push fails "GitHub not configured"
  after launch, naming exactly the missing piece.

### FR8.1 — Relaying telemetry through the cluster-agent *(added 2026-08-28)*

Posting straight to the public sink works, and loses a batch to any blip: a run
pod has no queue and makes no second attempt. A satellite may instead point its
pods at its OWN cluster-agent, which forwards the batch through the same event
proxy everything else in that cluster reports through.

- `POST /api/cluster/agent-events` accepts NDJSON and hands it to the proxy
  VERBATIM. This service does not parse stream-json and must not learn to: the
  Floor owns that projection, and a relay that reshapes its payload is a second
  parser to keep in sync. ([validated by [queues the body verbatim](apps/cluster-agent/src/delivery/routes/agent-events.test.ts#L40), [posts the body verbatim to the Floor's sink](apps/cluster-agent/src/kernel/telemetry-sink.test.ts#L29))
- The relay accepts either credential this cluster legitimately holds — the
  bus-wide `LORE_INGEST_TOKEN` centrally, or the per-agent token a satellite
  received at registration and published into `agent-secrets` for exactly these
  pods. Both are resolved PER REQUEST: a captured list would start refusing the
  cluster's own pods the moment a re-registration rotated the token. ([validated by [accepts the satellite's own per-agent token](apps/cluster-agent/src/delivery/routes/agent-events.test.ts#L47), [resolves the token per call](apps/cluster-agent/src/kernel/telemetry-sink.test.ts#L49))
- A credential matching neither is refused `401`, and a cluster holding NO
  credential yet refuses `500` rather than accepting anything — before
  registration completes there is no door to open. ([validated by [refuses a token that matches none](apps/cluster-agent/src/delivery/routes/agent-events.test.ts#L60), [refuses when this cluster holds no credential yet](apps/cluster-agent/src/delivery/routes/agent-events.test.ts#L69), [refuses a request carrying no authorization header](apps/cluster-agent/src/delivery/routes/agent-events.test.ts#L80))
- A body past the Floor's own 8 MiB cap is refused `413` here rather than
  buffered and then found undeliverable. ([validated by [refuses a body past the cap](apps/cluster-agent/src/delivery/routes/agent-events.test.ts#L86))
- Before registration completes there is no token to present, and the relay
  forwards ANYWAY rather than dropping the batch: the Floor refuses it, the
  ladder reads that refusal as a rotation, re-registers, and the retry carries
  the freshly minted credential. Refusing to send would lose the batch with
  nothing left to trigger the recovery. ([validated by [posts with no authorization header before this cluster has registered](apps/cluster-agent/src/kernel/telemetry-sink.test.ts#L69))
- Forwarding rides the proxy's ladder, so a refusal re-registers before it
  retries exactly as a terminal report does — the relay's onward leg carries the
  status on its throw so the ladder can tell a rotation from a blip. ([validated by [throws with the status attached](apps/cluster-agent/src/kernel/telemetry-sink.test.ts#L90), [refuses an event message](apps/cluster-agent/src/kernel/telemetry-sink.test.ts#L102))
- Opting in is one knob, `floorUrl` / `LORE_FLOOR_URL`, and it is OFF by
  default: it mounts the route, creates the Service the pods resolve, and points
  the run-pod egress hole at the cluster-agent instead of the Floor. A chart
  value that silently makes another one required would break every existing
  satellite on upgrade, so nothing is derived. ([validated by [`check-cluster-agent-standalone-render.sh`](scripts/check-cluster-agent-standalone-render.sh#L1))

## FR7 — Registered-clusters visibility

Operators need to see which clusters exist, what they can run, and whether
they are alive.

- `GET /api/cluster-agents` lists registered agents with `name`, `tags`,
  `status`, `last_seen_at`, and the count of runs each is currently
  executing. ([validated by `list.test.ts:51`](apps/lore-api/src/api/routes/cluster-agents/list.test.ts#L51), [`list.test.ts:41`](apps/lore-api/src/api/routes/cluster-agents/list.test.ts#L41), [`list.test.ts:88`](apps/lore-api/src/api/routes/cluster-agents/list.test.ts#L88), [`assembly-runs.contract.test.ts:1068`](libs/shared/src/project/assembly-runs/assembly-runs.contract.test.ts#L1106))
- A web-ui page renders that list, marking offline agents and linking the
  running-claims count to the assembly-runs list filtered to that agent
  (`/assembly-runs?cluster_agent_id=…`, backed by the port's
  `clusterAgentId` open-claim filter). ([validated by `assembly-runs.contract.test.ts:1035`](libs/shared/src/project/assembly-runs/assembly-runs.contract.test.ts#L1037), [validated by `ClusterAgentsView.test.tsx:64`](apps/web-ui/src/app/cluster-agents/ClusterAgentsView.test.tsx#L64), [`ClusterAgentsView.test.tsx:91`](apps/web-ui/src/app/cluster-agents/ClusterAgentsView.test.tsx#L91), [`ClusterAgentsView.test.tsx:108`](apps/web-ui/src/app/cluster-agents/ClusterAgentsView.test.tsx#L108), [`cluster-agents.test.ts:29`](apps/web-ui/src/lib/api/cluster-agents.test.ts#L29))
- The app hands out the connect-a-cluster values it already holds (#1572):
  admin-scoped `GET /api/cluster-agents/install-info` answers the central
  URLs and the registration token (or names exactly what is unconfigured),
  `GET /api/cluster-agents/install.sh` serves a runnable installer with the
  same values baked in and shell-quoted, and the Clusters page renders the
  ready-to-paste command from them. The LLM credential and GHCR pull
  credentials stay deliberately un-baked. ([validated by `install.test.ts:11`](apps/lore-api/src/api/routes/cluster-agents/install.test.ts#L11), [`install.test.ts:22`](apps/lore-api/src/api/routes/cluster-agents/install.test.ts#L22), [`install.test.ts:38`](apps/lore-api/src/api/routes/cluster-agents/install.test.ts#L38), [`install.test.ts:49`](apps/lore-api/src/api/routes/cluster-agents/install.test.ts#L49), [`install.test.ts:61`](apps/lore-api/src/api/routes/cluster-agents/install.test.ts#L61), [`install.test.ts:68`](apps/lore-api/src/api/routes/cluster-agents/install.test.ts#L68), [`ConnectClusterPanel.test.tsx:20`](apps/web-ui/src/app/cluster-agents/ConnectClusterPanel.test.tsx#L20), [`ConnectClusterPanel.test.tsx:33`](apps/web-ui/src/app/cluster-agents/ConnectClusterPanel.test.tsx#L33), [`ConnectClusterPanel.test.tsx:44`](apps/web-ui/src/app/cluster-agents/ConnectClusterPanel.test.tsx#L44))
- The audit log's `cluster_agent_offline` entries surface on the same page,
  so a flapping cluster is diagnosable without database access. ([validated by `ClusterAgentsView.test.tsx:122`](apps/web-ui/src/app/cluster-agents/ClusterAgentsView.test.tsx#L122), [`ClusterAgentsView.test.tsx:143`](apps/web-ui/src/app/cluster-agents/ClusterAgentsView.test.tsx#L143), [`ClusterAgentsView.test.tsx:164`](apps/web-ui/src/app/cluster-agents/ClusterAgentsView.test.tsx#L164), [`ClusterAgentsView.test.tsx:180`](apps/web-ui/src/app/cluster-agents/ClusterAgentsView.test.tsx#L180), [`ClusterAgentsView.test.tsx:184`](apps/web-ui/src/app/cluster-agents/ClusterAgentsView.test.tsx#L184), [`audit-read.test.ts:7`](libs/shared/src/project/audit/audit-read.test.ts#L7), [`audit-read.test.ts:33`](libs/shared/src/project/audit/audit-read.test.ts#L33))

## FR9 — Pausing a cluster

Taking a cluster out of the rotation was possible but never an operation:
scaling its deployment to zero is read as death five minutes later and
requeues the work it was mid-way through, and re-registering with tags
nothing matches is a trick that loses the cluster's real tags.

- `pipeline.cluster_agents.paused` is the operator's switch, deliberately
  NOT a value of `status`. `status` is reaper-owned liveness; a paused agent
  is fully alive, keeps heartbeating and finishes what it already claimed —
  it is only passed over when new work is handed out. Conflating them would
  make pausing a cluster look exactly like losing one, and the reaper would
  pull its live work away. ([validated by `cluster-agents.test.ts:186`](libs/shared/src/project/cluster-agents/cluster-agents.test.ts#L187), [`cluster-agents.test.ts:209`](libs/shared/src/project/cluster-agents/cluster-agents.test.ts#L210), [`cluster-agents.test.ts:321`](libs/shared/src/project/cluster-agents/cluster-agents.test.ts#L322), [`pause.test.ts:45`](apps/lore-api/src/api/routes/cluster-agents/pause.test.ts#L45))
- `PUT /api/cluster-agents/{id}/paused` flips it, scoped `write` — unlike its
  register/claim/heartbeat siblings this route serves the UI, and the cluster
  being paused is precisely not the caller. Unknown id answers `404`. ([validated by `pause.test.ts:23`](apps/lore-api/src/api/routes/cluster-agents/pause.test.ts#L23), [`pause.test.ts:35`](apps/lore-api/src/api/routes/cluster-agents/pause.test.ts#L35), [`pause.test.ts:55`](apps/lore-api/src/api/routes/cluster-agents/pause.test.ts#L55))
- A paused agent's claim answers `204` — byte-identical to "nothing queued
  for you", so the switch needs no new client behaviour at all: the
  satellite's existing idle backoff simply keeps polling until an operator
  un-pauses it. The queued run is untouched and another cluster may take it.
  Enforced at the route, which already resolves the agent, rather than in the
  claim SQL: pausing is a fact about the cluster-agent, and the station-run
  queue has no business knowing about the registry. ([validated by `claim.test.ts:90`](apps/lore-api/src/api/routes/cluster-agents/claim.test.ts#L90))
- The Clusters page carries the switch as a per-row toggle, and shows
  `paused` as a badge beside liveness rather than instead of it. Each row's
  button takes the agent id as a BOUND parameter of the server action, never
  an inline closure over it: the view is a server component, and React
  refuses to serialize a plain function to a client component — which took
  the whole page down the first time (fixed the same day). ([validated by `ClusterAgentsView.test.tsx:34`](apps/web-ui/src/app/cluster-agents/ClusterAgentsView.test.tsx#L34), [validated by `PauseClusterButton.test.tsx:7`](apps/web-ui/src/app/cluster-agents/PauseClusterButton.test.tsx#L7), [`PauseClusterButton.test.tsx:16`](apps/web-ui/src/app/cluster-agents/PauseClusterButton.test.tsx#L16), [`actions.test.ts:17`](apps/web-ui/src/app/cluster-agents/actions.test.ts#L17), [`actions.test.ts:26`](apps/web-ui/src/app/cluster-agents/actions.test.ts#L26))

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
contract is never handed to a claimant. ([validated by `assembly-runs.contract.test.ts:940`](libs/shared/src/project/assembly-runs/assembly-runs.contract.test.ts#L942))

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
   **Done 2026-08-29.** What remained was the half the flip did not cover —
   task types with no assembly-line YAML (runbook / onboard / review), which
   still pushed a single CR. They enqueue a claimable visit now like every
   other node, so `POST /api/cluster/agents`, `HttpAgentApi.create` and the
   Floor's `agentCrBackend()` are gone, and with them the last thing that made
   "which cluster" a question the Floor could answer.

   Two consequences the flip had deferred are settled in the same change.
   Registration stops being optional at every layer (above, FR3), and the
   terminal-CR handler stops reading the cluster back: it settles a run from
   what the event REPORTED plus what the Floor itself wrote down, because a run
   claimed elsewhere was never readable from here — `HttpAgentApi.get` answered
   `found:false` indistinguishably from "no such CR". The single-CR row's queue
   wait and offline-requeue are picked up by the reaper's definition-less arm,
   which previously bounded nothing.

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
  a call with a stale token is rejected. Registration and claiming are
  exercised together against a migrated Postgres — an agent presenting the
  registration token is registered and can then claim with the per-agent token
  it was minted, while a wrong registration token and another agent's per-agent
  token are both refused. ([validated by refuses registration without the pre-shared token](apps/lore-api/src/integration-tests/cluster-agent-claim.test.ts#L264), [`cluster-agent-claim.test.ts:251`](apps/lore-api/src/integration-tests/cluster-agent-claim.test.ts#L251), [`cluster-agent-claim.test.ts:142`](apps/lore-api/src/integration-tests/cluster-agent-claim.test.ts#L142))
- FR2: a run requiring `gpu` is never handed to an agent without it; a run
  with empty `required_tags` is claimable by any agent. Asserted against the
  real `required_tags <@ tags` containment as well as the in-memory double,
  because that operator reads correctly in either direction and is wrong in
  one of them. ([validated by does not hand a run to an agent missing one of its required tags](apps/lore-api/src/integration-tests/cluster-agent-claim.test.ts#L194), [`single-cr-dispatch-acceptance.test.ts:226`](apps/floor/src/jobs/station/single-cr-dispatch-acceptance.test.ts#L226), [`single-cr-dispatch-acceptance.test.ts:210`](apps/floor/src/jobs/station/single-cr-dispatch-acceptance.test.ts#L210), [`single-cr-dispatch-acceptance.test.ts:239`](apps/floor/src/jobs/station/single-cr-dispatch-acceptance.test.ts#L239))
- FR3: two agents claiming concurrently never receive the same run; a
  human-station or service-node row is never returned by a claim; the
  minikube acceptance walk ends with a PR authored from a locally executed
  station run. A queued row that has not been armed yet is likewise never
  handed out — the walk writes the row and its dispatch spec in two
  statements, and a claim between them would consume a visit with nothing to
  launch. ([validated by never hands one visit to two clusters](apps/lore-api/src/integration-tests/cluster-agent-claim.test.ts#L275), [`cluster-agent-claim.test.ts:226`](apps/lore-api/src/integration-tests/cluster-agent-claim.test.ts#L226), [`cluster-agent-claim.test.ts:165`](apps/lore-api/src/integration-tests/cluster-agent-claim.test.ts#L165), [`single-cr-dispatch-acceptance.test.ts:258`](apps/floor/src/jobs/station/single-cr-dispatch-acceptance.test.ts#L258))
- FR3 (single-CR): a task type with no assembly line takes the same path. The
  round trip is walked cluster-free through the production functions of all
  three processes — the Floor's launch seam, the claim, the CR the claiming
  cluster builds, the terminal event its watch reports, and the report the
  Floor settles from — so a hand-off that is correct on one side and wrong on
  the other fails here rather than in a silent run. ([validated by reaches the Floor's terminal report carrying the task it started from](apps/floor/src/jobs/station/single-cr-dispatch-acceptance.test.ts#L88), [`single-cr-dispatch-acceptance.test.ts:120`](apps/floor/src/jobs/station/single-cr-dispatch-acceptance.test.ts#L120), [`single-cr-dispatch-acceptance.test.ts:160`](apps/floor/src/jobs/station/single-cr-dispatch-acceptance.test.ts#L160), [`single-cr-dispatch-acceptance.test.ts:184`](apps/floor/src/jobs/station/single-cr-dispatch-acceptance.test.ts#L184))
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
