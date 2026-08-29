---
adr_number: 24
title: "Ubiquitous language for the execution model: Factory / Floor / AssemblyLine / Station / Agent"
status: in progress
date: 2026-06-15
domains: [agent, pipeline, ux, governance, web-ui, infra]
---

# ADR-024: Ubiquitous language for the execution model

This ADR adopts a single factory-metaphor vocabulary (Factory ⊃ Floor ⊃ AssemblyLine ⊃ Station ⊃ Agent) so the overloaded word "agent" stops meaning four different things, reserving it for one ephemeral Claude-plus-prompt run.

## Context

"Agent" had been overloaded across the codebase, specs, and ADRs to mean at
least four different things:

1. the Claude CLI/API + a prompt — one ephemeral run;
2. the Kubernetes Job pod (or local sandbox) that hosts such a run;
3. the long-running coordinator deployment ("Lore Agent" — `apps/agent`,
   the `lore-agent` namespace) that polls the queue, dispatches work, runs the
   cron jobs, and reaps leases;
4. the workflow graph that sequences steps with hand-offs and waits.

Conflating these made design discussion imprecise (e.g. "the agent runs in a
pod" — which agent? the run, the pod, or the coordinator?) and made it hard to
name new work — the BYO-container effort is literally "let the thing that runs
an agent be any image," which has no clean name while #2 is also called "agent."

## Decision

Adopt a single factory-metaphor vocabulary. Dark Factory (ADR-016) already
commits the platform to the manufacturing metaphor; this names the rest of it.

| Term | What it is | Cardinality |
|---|---|---|
| **Factory** | the whole platform — Lore itself | 1 |
| **Floor** | the coordinator runtime: dispatches Agents onto Stations, runs AssemblyLines, reaps leases | 1 → N |
| **AssemblyLine** | the **blueprint** — an authored, versioned, content-hashed graph of Stations that hand off / wait on each other (amendment 2026-08-14) | per task type |
| **AssemblyRun** | one **execution** of an AssemblyLine, carrying a clone of the blueprint it runs (amendment 2026-08-14) | per attempt |
| **Station** | the unit that runs one piece of work — an LLM Agent, a deterministic station run (validate/detect/…, ADR-031 amendment), a **human station** whose worker is a person and whose `route` names the page they work on, or a **service station** reached by name over HTTP (amendment 2026-08-23) | per node, or standalone |
| **StationRun** | one **visit** to a Station within an AssemblyRun — `(run, node, iteration)`, identified by a `station_run_id` (amendment 2026-08-14) | per node-run |
| **Agent** | one ephemeral run of the Claude CLI/API + a prompt (context + task) | per Station |
| **Agent definition** | the stored *config* an Agent runs from — model, timeout, prompt, execution image — resolved per repo (project row → org default → `task-types.yaml`) | per task-type (× repo) |

### A Station's execution forms (amendment 2026-08-23)

A Station is a unit of work; *how* it runs is a separate question, and there are
four answers. The table above listed three; this names the fourth and says when
each applies.

| form | dispatched by | holds a pool | for |
|---|---|---|---|
| K8s Job pod | an AssemblyLine node | no — the station HTTP seam | nodes needing isolation, a workspace clone, per-node identity, a deadline |
| local sandbox / worktree | the local runner | no | developer machines |
| human station | a person, via `route` | n/a | author review, PR merge |
| **service station** | an HTTP call, `POST /api/stations/{name}` | **yes** | standalone work: the cron sweeps |

The fourth exists because the first was being paid for work that did not need
it. A once-a-minute sweep has no workspace to clone, no node identity, and no
deadline worth a CR — yet to be a Station at all it had to be wrapped in a
one-node AssemblyLine with a `retrospective` marker, and then, because a pod
holds no database, reach its data through an HTTP seam. `merge-check` alone
would have needed ~23 new methods on that seam. A Station that sits beside the
data just asks the data.

A service station is named, not authored: the name is the URL, and the registry
entry is the whole declaration.

- The named station runs and reports one summary line — the same
  `(): Promise<string>` these jobs always had, which the Floor's scheduler
  writes into the `pipeline.job_runs` row it already opens. ([validated by runs the named station and returns the summary it reported](apps/stations/src/delivery/routes/stations.test.ts#L31))
- A name nothing answers to is refused with the registry's contents, rather than
  failing somewhere inside an undefined call. ([validated by refuses a name no station answers to, rather than 500-ing on undefined](apps/stations/src/delivery/routes/stations.test.ts#L38))
- Running a station requires the same token every other service-to-service call
  presents. ([validated by refuses a caller with no bearer token](apps/stations/src/delivery/routes/stations.test.ts#L45))
- A station already running refuses the second caller rather than sweeping
  twice. The Floor is a single replica today, so this is what makes a second one
  — or a retried tick — safe rather than a double sweep. ([validated by refuses a second concurrent run of the same station](apps/stations/src/delivery/routes/stations.test.ts#L54))
- The guard releases after the run, including after a FAILED one: a station that
  threw must not stay latched, or one bad run wedges it until the process
  restarts. ([validated by frees the latch after a run so the next tick is not locked out forever](apps/stations/src/delivery/routes/stations.test.ts#L79), [`stations.test.ts:85`](apps/stations/src/delivery/routes/stations.test.ts#L85))
- The caller and the route are two halves of one contract, so they are exercised
  against each other: the summary comes back for the `job_runs` row, and every
  refusal throws rather than resolving to an empty success that would log a
  sweep which never ran. ([validated by returns the summary the station reported, for the job_runs row](apps/stations/src/delivery/routes/station-client-roundtrip.test.ts#L40), [`station-client-roundtrip.test.ts:46`](apps/stations/src/delivery/routes/station-client-roundtrip.test.ts#L46), [`station-client-roundtrip.test.ts:52`](apps/stations/src/delivery/routes/station-client-roundtrip.test.ts#L52), [`station-client-roundtrip.test.ts:62`](apps/stations/src/delivery/routes/station-client-roundtrip.test.ts#L62))

The Floor keeps the schedule, the `job_runs` row and the overlap guard — it
still owns *when* a station runs; it stops owning *what* the station does.

### Cluster authority is exercised through a per-cluster agent (amendment 2026-08-24)

The Floor holds a Kubernetes client no longer. `apps/cluster-agent` is the only
process that talks to a given cluster's API; the Floor and lore-api reach it
over HTTP through the ports they already used, so their call sites kept their
shape.

The cut is the mirror of the station one. There, work moved TO the data; here,
the cluster moves AWAY from it. The Floor's data surface is ~145 calls across
~70 methods and its cluster surface is a dozen operations — so the cheap
extraction was never the data, and a satellite cluster becomes a small agent
rather than a second brain.

Every route is a DOMAIN operation, not a Kubernetes verb, because two of the
underlying interactions are read-modify-write pairs. Exposing `get` and
`replace` separately would invite a caller to split a pair across the network
and lose the update; no `resourceVersion` ever crosses the wire.

- A CR that already exists reports `created:false` rather than failing, so a
  redelivered dispatch is idempotent. *(Amended 2026-08-29: this is no longer a
  route. Dispatch is pull-only — the agent CREATES CRs only for runs it claimed
  itself, so the inbound `POST /api/cluster/agents` was deleted and the
  idempotency now lives in the adapter behind the claim. Everything below still
  describes the read surface, which callers do still reach over HTTP.)*
  ([validated by reports created:false for code 409, so a redelivered claim is idempotent](apps/cluster-agent/src/kernel/kube-agent-api.test.ts#L35), [`kube-agent-api.test.ts:28`](apps/cluster-agent/src/kernel/kube-agent-api.test.ts#L28), [`kube-agent-api.test.ts:42`](apps/cluster-agent/src/kernel/kube-agent-api.test.ts#L42), [`kube-agent-api.test.ts:48`](apps/cluster-agent/src/kernel/kube-agent-api.test.ts#L48), [`kube-agent-api.test.ts:54`](apps/cluster-agent/src/kernel/kube-agent-api.test.ts#L56))
- A missing CR is an ordinary answer — `found:false` at 200, not a 404 that
  would be indistinguishable from the route itself being absent. ([validated by answers 200 with found:false for a missing CR, not 404](apps/cluster-agent/src/delivery/routes/cluster.test.ts#L76), [`cluster.test.ts:150`](apps/cluster-agent/src/delivery/routes/cluster.test.ts#L134))
- The list serves ONE apiserver page per call and the caller drives `continue`.
  A one-shot list is not a convenience: 180 accumulated CRs at ~1.4MB of status
  each blew Node's heap and crash-looped the Floor on 2026-07-24. ([validated by passes the caller's continue token straight through, one page per call](apps/cluster-agent/src/delivery/routes/cluster.test.ts#L87), [`cluster.test.ts:104`](apps/cluster-agent/src/delivery/routes/cluster.test.ts#L100), [`cluster.test.ts:311`](apps/cluster-agent/src/delivery/routes/cluster.test.ts#L265), [`cluster.test.ts:294`](apps/cluster-agent/src/delivery/routes/cluster.test.ts#L248))
- The paging the route requires is walked by the CLIENT, not pushed onto every
  caller: `listByLabel` follows `continue` to the end and returns the whole
  match. A truncated list is worse than a failed one — it answers, and the
  caller acts on a subset it believes is complete.
  ([validated by returns every page's items, not just the first](libs/shared/src/cluster/cluster-agent-client.test.ts#L30), [`cluster-agent-client.test.ts:42`](libs/shared/src/cluster/cluster-agent-client.test.ts#L42), [`cluster-agent-client.test.ts:56`](libs/shared/src/cluster/cluster-agent-client.test.ts#L56), [`cluster-agent-client.test.ts:64`](libs/shared/src/cluster/cluster-agent-client.test.ts#L64))
- *(Removed 2026-08-30: the status subresource route and `patchAgentStatus` are
  gone — the watcher went cluster-blind and nothing calls it any more. The
  read-modify-write conflict ladder this statement described no longer has
  a caller to protect.)*
- A catalog pair is written station-first and deleted station-last, so an
  AgentDefinition — the thing a dispatch looks up — is never visible pointing at
  a station that does not exist. ([validated by writes the station before the agent definition that points at it](apps/cluster-agent/src/kernel/paired-writes.test.ts#L35), [`paired-writes.test.ts:43`](apps/cluster-agent/src/kernel/paired-writes.test.ts#L43), [`paired-writes.test.ts:62`](apps/cluster-agent/src/kernel/paired-writes.test.ts#L62))
- A refusal is read by its status, never collapsed: 404 is absence, 403 names
  the Role rule that is missing, anything else is a failure. ([validated by reads the code this client version sets](apps/cluster-agent/src/kernel/k8s-errors.test.ts#L13), [`k8s-errors.test.ts:17`](apps/cluster-agent/src/kernel/k8s-errors.test.ts#L17), [`k8s-errors.test.ts:21`](apps/cluster-agent/src/kernel/k8s-errors.test.ts#L21), [`k8s-errors.test.ts:25`](apps/cluster-agent/src/kernel/k8s-errors.test.ts#L25), [`k8s-errors.test.ts:31`](apps/cluster-agent/src/kernel/k8s-errors.test.ts#L31), [`k8s-errors.test.ts:38`](apps/cluster-agent/src/kernel/k8s-errors.test.ts#L38), [`k8s-errors.test.ts:47`](apps/cluster-agent/src/kernel/k8s-errors.test.ts#L47), [`k8s-errors.test.ts:59`](apps/cluster-agent/src/kernel/k8s-errors.test.ts#L59), [`k8s-errors.test.ts:69`](apps/cluster-agent/src/kernel/k8s-errors.test.ts#L69))
- The status is read wherever this client puts it, including out of the message,
  which is the only place it appears for some refusals. A Secret write that loses
  an optimistic-concurrency race arrives as `HTTP-Code: 409 / Unknown API Status
  Code!` with every structured field undefined; read as no status at all, the
  retry that exists for exactly that race never fires, and provisioning fails
  whenever two agents start at once. A thrown value whose message is not a string carries no status either,
  rather than throwing from inside the classifier that exists to keep failures
  legible. ([validated by reads 409 out of the message when it is nowhere else](apps/cluster-agent/src/kernel/k8s-errors.test.ts#L87), [`k8s-errors.test.ts:91`](apps/cluster-agent/src/kernel/k8s-errors.test.ts#L91), [`k8s-errors.test.ts:96`](apps/cluster-agent/src/kernel/k8s-errors.test.ts#L96), [`k8s-errors.test.ts:101`](apps/cluster-agent/src/kernel/k8s-errors.test.ts#L101), [retries the replace when the lost race arrives as a prose-only 409](apps/cluster-agent/src/kernel/kube-token-provisioner.test.ts#L68), [`kube-token-provisioner.test.ts:85`](apps/cluster-agent/src/kernel/kube-token-provisioner.test.ts#L85), [`kube-token-provisioner.test.ts:94`](apps/cluster-agent/src/kernel/kube-token-provisioner.test.ts#L94))
- *(Removed 2026-08-30: `POST /api/cluster/per-task-tokens` and its route-level
  "provisions in one call" test are gone — every launch is a claim now (#1651),
  so provisioning runs in-process through `KubeTokenProvisioner.provision`
  directly; the reclaim half stays a route.)*
- `DELETE /api/cluster/per-task-tokens/{taskId}` reclaims a terminal task's
  Secret key and catalog clones — the one per-task-token operation that stays
  a route, since a settled task's cleanup runs from the Floor, not the cluster
  that provisioned. ([validated by reclaims a task's token and catalog clones](apps/cluster-agent/src/delivery/routes/cluster.test.ts#L217))
- One call also means one OUTCOME: a provision whose recipe pair fails to land
  takes back everything it had already provisioned — the Secret key AND any
  catalog object that landed before the failure — before it throws. `cleanup`
  runs off a task reaching a terminal state, and a task whose pod was never
  created may never reach one — so a partial triple would outlive the launch it
  was minted for: a live credential nobody uses, a row in the accumulation that
  once took `agent-secrets` past its 1MiB ceiling, or a recipe pointing at a
  token that reclaim already removed. ([validated by leaves no token or AgentDefinition behind when applyStation fails](apps/cluster-agent/src/kernel/kube-token-provisioner.test.ts#L167), [`kube-token-provisioner.test.ts:190`](apps/cluster-agent/src/kernel/kube-token-provisioner.test.ts#L190), [`kube-token-provisioner.test.ts:212`](apps/cluster-agent/src/kernel/kube-token-provisioner.test.ts#L212))
- A catalog pair is applied in one call, so create-409-replace cannot be split.
  ([validated by applies a catalog pair in one call, so create-409-replace cannot be split](apps/cluster-agent/src/delivery/routes/cluster.test.ts#L146), [`cluster.test.ts:274`](apps/cluster-agent/src/delivery/routes/cluster.test.ts#L228), [`cluster.test.ts:285`](apps/cluster-agent/src/delivery/routes/cluster.test.ts#L239), [`cluster.test.ts:304`](apps/cluster-agent/src/delivery/routes/cluster.test.ts#L258), [refuses a catalog pair whose body is not a pair](apps/cluster-agent/src/delivery/routes/cluster.test.ts#L167), [`cluster.test.ts:174`](apps/cluster-agent/src/delivery/routes/cluster.test.ts#L174))
- The log tail is clamped by the AGENT, because the Floor's clamp no longer
  protects this process's heap. ([validated by clamps the tail server-side rather than trusting the caller](apps/cluster-agent/src/delivery/routes/cluster.test.ts#L124), [`cluster.test.ts:243`](apps/cluster-agent/src/delivery/routes/cluster.test.ts#L197), [`cluster.test.ts:253`](apps/cluster-agent/src/delivery/routes/cluster.test.ts#L207), [`cluster.test.ts:233`](apps/cluster-agent/src/delivery/routes/cluster.test.ts#L187))
- Every route requires the same bearer token every other service-to-service
  call presents. ([validated by refuses every route without a bearer token](apps/cluster-agent/src/delivery/routes/cluster.test.ts#L158))
- A CR the controller has not stamped yet reads as Pending rather than absent —
  the distinction a watcher acts on. ([validated by a CR the controller has not stamped yet maps to Pending, not absence](libs/shared/src/cluster/agent-node-status.test.ts#L6), [`agent-node-status.test.ts:16`](libs/shared/src/cluster/agent-node-status.test.ts#L16))
- An empty minted token is refused where the cause is legible, rather than
  written as a present-but-useless Secret key that fails later inside a pod's
  init container. ([validated by throws naming the repo and the App vars when the token comes back empty](apps/cluster-agent/src/kernel/kube-token-provisioner.test.ts#L19), [`kube-token-provisioner.test.ts:11`](apps/cluster-agent/src/kernel/kube-token-provisioner.test.ts#L11))


The callers keep their behaviour, not just their shape. A CR that no longer
exists is an ordinary answer and stops the work; anything else throws so the
caller retries rather than treating a denial as an absence — the distinction the
Floor used to make by sniffing a 404 out of a Kubernetes error, and the reason
`found:false` is served at 200.

*Amended 2026-08-29: the `kubernetes.agent` handler is no longer one of these
callers. It used to re-GET the terminal CR before processing it, which silently
scoped settling a run to the one cluster this Floor can reach; it now settles
from the event's own report, which carries the full status. The distinction
above still governs the READ surface — the reconcile pass, the reaper's status
probe, the pod-log reads — where a caller genuinely has to ask.*
  ([validated by answers 200 with found:false for a missing CR, not 404](apps/cluster-agent/src/delivery/routes/cluster.test.ts#L76), [`k8s-errors.test.ts:31`](apps/cluster-agent/src/kernel/k8s-errors.test.ts#L31), [`k8s-errors.test.ts:47`](apps/cluster-agent/src/kernel/k8s-errors.test.ts#L47), [`k8s-errors.test.ts:59`](apps/cluster-agent/src/kernel/k8s-errors.test.ts#L59), [`kubernetes.test.ts:30`](apps/floor/src/jobs/kubernetes.test.ts#L30), [`kubernetes.test.ts:58`](apps/floor/src/jobs/kubernetes.test.ts#L58), [`kubernetes.test.ts:64`](apps/floor/src/jobs/kubernetes.test.ts#L64))

The reconcile pass keeps paging, and its seam narrowed with the cut: it now
depends on one page-fetch method rather than a slice of a Kubernetes client, so
a test fakes the thing it actually needs.
  ([validated by walks every page via the continue token and passes the page limit](apps/floor/src/listeners/agent-reconcile.test.ts#L56), [`agent-reconcile.test.ts:79`](apps/floor/src/listeners/agent-reconcile.test.ts#L79), [`agent-reconcile.test.ts:92`](apps/floor/src/listeners/agent-reconcile.test.ts#L92))

The Role this service carries also closes two gaps the Floor had been silently
living with: it never held `delete` on `agents` or `agents/status`, yet issued
both at sites that swallowed the failure — which is why the CR prune could
never actually shrink the pile it was written to shrink.
  ([validated by deletes a CR — the verb the Floor's RBAC never granted](apps/cluster-agent/src/delivery/routes/cluster.test.ts#L111))

Hierarchy: **Factory ⊃ Floor(s) ⊃ AssemblyLines ⊃ Stations ⊃ Agents** — the design
side; its runtime shadow is **AssemblyRun ⊃ StationRuns ⊃ Agents**.

- **"Agent" is reserved** for sense #1 (the Claude-plus-prompt run). It is never
  the pod, the coordinator, or the workflow. Nuance since the ADR-031 amendment:
  the Agent *CR* is the work-order for **one run at a Station** — when the
  station is deterministic (exec vendor, no LLM), that run is a "station run",
  not an Agent, even though the CR kind says `Agent`.
- An **Agent definition** is *config, not a run* — the recipe a Station
  instantiates into an Agent; one definition, many Agents. It is never called
  "an Agent". The runtime/operator identity (`agent_id` on tasks and memories) is
  a **session** — also distinct from both. How definitions are stored and reached
  is decided in [Agent definitions as data](#agent-definitions-as-data) below.
- The deployment formerly called "Lore Agent" is the **Floor**. There may be
  more than one Floor per Factory (per team, per cluster/region, or per trust
  tier — e.g. a full-trust Floor vs a docs-only Floor); the schema-per-team
  isolation and per-repo trust tiers already point this way.
- **Factory is the whole platform**, not the coordinator — so the coordinator is
  not named "Factory" (that would forbid ever saying "the Factory" about the
  product, and preclude multiple Floors).
- **Amendment 2026-08-14 — a blueprint is not a run.** "AssemblyLine" named both
  the authored YAML and one execution of it, and the table holding executions was
  called `pipeline.assembly_lines`, so every sentence about either had to
  disambiguate itself and the code could not: a run referenced its blueprint by
  NAME and re-read the file on every step, which let an edit change the graph
  under a walk in flight and left a renamed blueprint's own history undrawable.
  An **AssemblyRun** therefore CLONES its AssemblyLine at start and reads the
  clone thereafter, and a **StationRun** is one visit within it. The blueprint
  side keeps the old names (`libs/assembly-lines`, the YAMLs, the loader, the
  transition kernel) precisely because that is now all they mean.
- **A Station's worker may be a person.** A **human station** is a Station like
  any other — it reports the same outcome contract — and it declares the page its
  worker acts on: a route this platform serves (the planning wizard's
  `feature_review`) or one it does not (`pr_review`, the GitHub PR view). Naming
  the surface in the blueprint is what stops each interface from keeping its own
  private map of which node means which screen.

Current-code mapping:

| Term | Today's code |
|---|---|
| Floor | `apps/floor` (the `lore-floor` deployment) |
| AssemblyLine | the assembly line YAML + transition kernel (`@re-cinq/lore-assembly-lines`) |
| AssemblyRun | a `pipeline.assembly_runs` row, reached via `project.assemblyRuns` |
| Station | one `Agent` CR pod per node on the ai-agent-subsystem (`ai-agents` namespace) — `claude` for agent nodes, the `exec`-vendor `lore-station` image for non-agent nodes — or the local runner sandbox; a human station dispatches nothing and serves a `route` instead |
| StationRun | a `pipeline.station_runs` row, keyed by `station_run_id` |
| Agent | the `claude --print` / `Llm` invocation |
| Agent definition | the `lore.agent_definitions` table, reached via `project.agentDefs` |

## Alternatives rejected

- **"Factory" for the coordinator** — Factory is the whole platform; reusing it
  for one deployment collides and rules out multiple Floors per Factory.
- **"AgentPod" / "AgentLab" / "AgentFloor" for the Station** — `Pod` collides
  with the literal Kubernetes Pod and breaks for the local (non-pod) case;
  `Lab` connotes R&D, not production; `Floor` is the whole production area, not
  one unit. `Station` is the standard assembly-line term and pairs with
  AssemblyLine by construction.

## Consequences

- **Positive:** "agent" stops doing four jobs; design and docs get precise;
  Phase 3 (BYO container) names itself — "make a **Station** any image,"
  `ExecutionBackend` selects/builds a Station, `settings.execution.image` is the
  Station's image.
- **Done (follow-up PR):** the rename landed — `apps/agent` → `apps/floor`, the
  `lore-agent` namespace → `lore-floor`, package `@re-cinq/lore-agent` →
  `@re-cinq/lore-floor`, and the related Helm/Docker/CI references. Three
  external identities are intentionally preserved to avoid breakage: the GCP
  service account `lore-agent@…` (renaming a GSA is destroy+recreate, dropping
  its grants), the GitHub bot login `lore-agent[bot]`, and the
  `lore-agent-internal-token` secret (Secret-Manager source of truth). The
  `lore-agent` memory `agent_id` is also kept so existing memories still resolve.
- Specs reference the canonical glossary at [`specs/glossary.md`](../specs/glossary.md);
  retro-rewriting existing spec prose to the new terms rides with the code
  rename (it is link-safe but per-usage judgment, since "the agent" sometimes
  means the Agent and sometimes the Floor).

## Agent definitions as data

> Incorporates the decision originally drafted as ADR-026. It lives here because
> it is a direct application of the vocabulary above: the thing being stored is an
> **Agent definition**, deliberately *not* an Agent.

### Context

Per-task-type behaviour — model, timeout, prompt, container image — was hardcoded
org-wide in `scripts/task-types.yaml` (baked into the claude-runner image at
`/config/task-types.yaml`) and only thinly overridable per repo via a JSONB blob,
`lore.repos.settings.task_overrides[type]`. The settings UI surfaced just
model / timeout / a prompt *suffix*, buried in one scrolling form. Operators
could not define or retune a repo's agent definitions without a source edit and a
redeploy.

We want agent definitions to be **first-class, per-repo data** an operator edits
from the UI (and a developer edits from a skill), driving every Station — while
keeping the offline/bootstrap fallback the runner pods rely on.

### Decision

Promote agent-definition config to a table, **`lore.agent_definitions`**, reached
only through the Project facade port **`project.agentDefs`** (the config side;
`project.agents.run()` stays the execution side).

- **Schema.** `lore.agent_definitions(name, model, timeout_minutes, prompt, image,
  project_id, execution_mode, review_required, …)`. A row with `project_id = NULL`
  is the **organisation default**; a row with a `project_id` (→ `lore.repos.id`)
  is that repo's override. Partial unique indexes enforce one org default per
  name and one project override per `(name, repo)`. A definition is **pure config**:
  no `workflow` or `trigger` column (see below).

- **Resolution.** `resolveAgentConfig` field-merges three layers —
  project row → org row → `task-types.yaml` base. The yaml stays the **prompt
  base + offline fallback**, so seeded org rows carry only the tunable scalars
  (model/timeout/mode/review) and leave `prompt` to inherit the yaml.

- **One access path.** A new `AgentDefsPort` exposed as `project.agentDefs`
  (sibling to the execution facade `project.agents.run()`), with a three-way
  optional-port seam selected by environment: `PgAgentDefs` (DB present — floor,
  mcp-server), **`AgentDefsHttp` (Station pod / local stdio — the runner fetches
  its config over the API, same channel as context hydration)**, `AgentDefsYaml`
  (offline/bootstrap). No consumer reads `lore.agent_definitions` directly.

- **Runners fetch from the port.** The controller resolves only what k8s needs to
  *build* the Station (`image`, `timeout` → `activeDeadlineSeconds`); the runner
  fetches `model`/`prompt` (and any in-pod per-node config) from the API via
  `AgentDefsHttp` at `/api/repos/:o/:r/agent-definitions`. The pod never reaches
  Postgres.

- **Authorization.** Writes are admin-scoped; the `image` field stays two-key
  gated (CODEOWNERS `dark-factory-approval` PR, reusing `verifyApproval`), like
  `dark_factory.execution.image` (ADR-025). `GET` is read-scoped so a runner's
  task token can resolve definitions.

- **Workflows stay in the repo, not the DB.** An Agent definition is many-to-many
  with workflows, so the mapping lives only in the workflow YAML's `agent` nodes
  (referenced by name). Workflows change rarely and want PR review, so they
  belong in `.lore/workflows/*.yaml` (built-in `libs/assembly-lines` assembly lines as the
  fallback). What *starts* a run (the ingress event) is a property of the
  workflow (`on:`), not the definition — deferred to a follow-up (Phase 2) with
  the dispatch registry.

### Consequences (agent definitions)

- The Agents settings tab + `/lore-agents` skill edit definitions live; no redeploy.
- `task-types.yaml` is no longer the single source for the tunable scalars, but
  remains the prompt base and the DB-down fallback.
- Org-wide default edits now flow through the DB (audited in `pipeline.audit_log`)
  rather than a reviewed source change; org-level editing UI is secondary.
- The existing `task_overrides` JSONB is migrated into project rows (migration
  0015) and left in place but no longer read.
- The web UI's Agents tab shows two distinct things side by side — **Agent
  definitions** (this config) and **Sessions** (`agent_id` activity) — so the page
  never uses the bare word "Agents" to mean both.
- Phase 2 (separate): the `.lore/workflows/` loader and the workflow `on:`
  triggers + event-dispatch registry.

## Floor data access — all SQL behind the Project ports

The Floor (the coordinator) had ~130 hand-rolled SQL statements smeared across
~30 job files via a raw `query()` escape hatch (`apps/floor/src/kernel/db.ts`).
PR #749 single-sourced only the org-wide *queue mechanics* (`pipeline.tasks`
claim/sweep, `pipeline.events`, leases, audit) and deferred the rest. This ADR
records the completion of that extraction: **Floor reaches Postgres through the
shared `@re-cinq/lore-shared/project/*` ports**, not inline SQL.

- **Two access paths.** A job that holds a repo uses the per-repo facade
  (`projectFor(repo)` → `project.tasks` / `.settings` / `.usage` / `.issues` …).
  A cross-repo / no-repo job (most crons, the agent-events sink) uses a lazy
  port singleton in `apps/floor/src/kernel/queues.ts` (`taskStore()`,
  `settings()`, `evalRuns()`, `cost()`, `contextCore()`, `research()`,
  `baseline()`, `chunks()`, `memoryLifecycle()`) that binds the shared `Pg…`
  adapter to the pool.
- **The `pipeline` schema's own tables travel as ONE bundle**, not as one
  accessor each: `PipelineRepositories`
  (`libs/shared/src/project/pipeline/`) carries `taskQueue`, `eventQueue`,
  `assemblyRuns`, `jobRuns`, `audit`, `leases`, `agentRunEvents` and
  `agentRunTurns` behind a single object, built once per process from one pool
  by `createPipelineRepositories(pool)` and reached as `pipeline()` in Floor or
  `project.pipeline` in lore-api.
- The in-memory composition supplies a working double behind every field
  ([validated by carries a working double behind every field](libs/shared/src/project/pipeline/pipeline-repositories.test.ts#L7)).
- Its `overrides` bag swaps one field and leaves the other seven doubles standing
  ([validated by replaces only the overridden field](libs/shared/src/project/pipeline/pipeline-repositories.test.ts#L30)).
- *(Amended 2026-08: these eight were originally eight independent `queues.ts`
  accessors. That shape only ever described Floor — lore-api, which reaches
  ports through `Project`, had no route to `eventQueue`, `jobRuns`,
  `agentRunEvents` or `agentRunTurns` at all, and rebuilt three Pg adapters on
  every request because `createProject` runs per call. A bundle is what lets
  ONE construction serve both deployables; `taskQueue`/`eventQueue` keep the
  `Queue` suffix so neither can be misread as the repo-scoped `project.tasks`.)*
- **One home per table.** Each port ships a MODEL
  (`libs/shared/src/models/<entity>.ts` — a schema, the type inferred from it, and
  a map binding each field to the column that stores it) + a port interface + a Pg
  adapter that builds its SELECT list and maps its rows FROM that column map + an
  InMemory behavioral double + a colocated test. The Floor-local
  `kernel/repositories/*` halfway house was deleted. *(Amended 2026-08: this
  originally read "port interface + Pg adapter (SQL lifted byte-for-byte) +
  InMemory double + colocated test". Lifting SQL verbatim was the right move for
  a relocation, and the wrong resting place: it left each adapter restating the
  column list its table already defined, which is how one row type came to be
  declared five times and how two of them drifted to different spellings of the
  same key. Deriving the list means a column the table loses fails at the read
  instead of arriving as `undefined`.)*
- **Byte-for-byte hazards** flagged in #749 are honored: CAS status writes
  (`UPDATE … WHERE id AND status = '…'`) use `setStatusIf`, not `setStatus`;
  column-only stamps use `setColumns` (no status / no `updated_at`); gate-free
  task creation (spec-task / feature-decompose, which the trust gate would reject)
  uses `insertTask`, not `createTask`.
- **Legitimate pool passes remain:** the composition roots (`project-boot`,
  `kernel/queues`, lease backend, `Llm.configure({ costPool })`) and shared
  multi-app helpers that take a pool (`syncTasksToDb`) still call `getPool()` —
  they pass the pool to shared code, they do not run inline SQL.
- **Phase 2 (separate):** the spec-coverage / gap-detect / spec-drift jobs read
  vector-store chunk *content* (`{schema}.chunks` / `org_shared.chunks` with
  `content_type` / `file_path` filters), and a few read the global `lore.settings`
  / `lore.features` tables. These need a knowledge-read port surface and are the
  remaining inline-SQL holdouts, tracked as a fast follow.

## Amendment (2026-08): the Floor's three-powers membership test

The vocabulary above says what a Floor **is**; it never said what may **live inside
one**. Without that rule the Floor accreted work that merely happened to need a
long-running process: in-process LLM calls (onboarding generation, feature-request
translation, episode curation, memory consolidation), repo-content chunking, a
promptfoo shell-out, six read-only REST endpoints, and an Anthropic billing
importer. An audit of `apps/floor/src` (2026-08-19) found ~3,400 of 18,514 lines
that no property of the Floor justified.

**The Floor has exactly three exclusive powers.** Code that needs none of them does
not belong in the Floor process:

1. **Cluster authority** — Agent CR dispatch, per-task pod tokens, pod logs.
   *Revised 2026-08-24:* when this test was written the Floor held the Kubernetes
   credentials and the RBAC itself. It no longer does — the amendment above moved
   both to `apps/cluster-agent`, and the Floor's Role is deleted. The power the
   Floor keeps is the **authority**, not the credential: it decides what to
   dispatch, when to prune, and whose token to mint, and it exercises that
   decision over HTTP against exactly one cluster agent. That distinction is what
   lets a Floor coordinate a cluster it cannot reach a Kubernetes API in.
2. **The drain loop** — the single-instance `pipeline.events` claim
   (`FOR UPDATE SKIP LOCKED`), leases, and the reapers. Only the Floor is pinned
   to one replica and may therefore coordinate.
3. **The in-process SSE bus** — [ADR-037](./ADR-037-sse-run-observability.md),
   sound only under the Floor's `replicaCount: 1` pin.

Everything else has one of two homes:

| Shape of the work | Home |
|---|---|
| LLM- or repo-content-shaped: prompts, clones, chunking, shelling out to a CLI, reading a working tree | a **Station** — it already has a sandbox, a checkout, and a model |
| A data read or write with no coordination: REST reads, scoring, counter snapshots, batch imports | **`apps/lore-api`** ([ADR-032](./ADR-032-split-local-remote-api.md)) |

The test is deliberately about *powers*, not about cadence or weight. "It is a
nightly batch" and "it needs a long-running process" were the two arguments that
put every squatter where it is, and neither is a property only the Floor has.

**Pinned exceptions** — they fail the test on a reading of the code but pass on
the mechanism, and a later cleanup must not evict them. Three were pinned in
2026-08; one has since been retired by the work it predicted:

- The `/api/agent-events` NDJSON sink and the SSE stream are **welded** by the
  in-process bus. Splitting them requires PG `LISTEN`/`NOTIFY` first (ADR-037
  names it as the multi-replica swap); moving either alone goes dark.
- `/api/agent-logs` serves pod logs. *Revised 2026-08-24:* it no longer reads the
  Kubernetes API — it asks the cluster agent, which holds the `pods/log` RBAC the
  Floor gave up. The exception survives, but on a weaker footing: it is now a
  proxy in front of a proxy, kept only because `lore-ui` must not learn a second
  service's address. Give it a reason to move and it should move.
- ~~`/api/webhook/github`~~ — **retired 2026-08-24.** It moved to
  `apps/event-router` as one branch of `POST /api/events`
  ([ADR-044](./ADR-044-event-router-owns-the-event-bus.md)). The exception argued
  that relocating it "buys a network hop and a new failure mode"; that was true
  while the Floor owned the events table, and stopped being true once the router
  did. The hop the exception feared is now the hop the Floor pays anyway.

**Consequence.** After the eviction the Floor is: the drain loop and its reapers,
the listeners, the AssemblyRun walk, the Station/pod machinery, the Agent-CR
watcher, the detection fan-out, auto-merge authority, and the dispatch half of the
task worker — about 13,700 lines that each pass the test. Merge authority in
particular stays: it is deliberately not delegated to a pod.
