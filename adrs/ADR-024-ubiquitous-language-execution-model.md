---
adr_number: 24
title: "Ubiquitous language for the execution model: Factory / Floor / AssemblyLine / Station / Agent"
status: accepted
date: 2026-06-15
domains: [agent, pipeline, ux, governance, web-ui, infra]
---

# ADR-024: Ubiquitous language for the execution model

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
| **AssemblyLine** | a graph of Stations with distinct responsibilities that hand off / wait on each other | per task |
| **Station** | the unit that runs exactly one node's work (a K8s Job pod, or a local sandbox/worktree) — an LLM Agent *or* a deterministic station run (validate/detect/…, ADR-031 amendment) | per node-run |
| **Agent** | one ephemeral run of the Claude CLI/API + a prompt (context + task) | per Station |
| **Agent definition** | the stored *config* an Agent runs from — model, timeout, prompt, execution image — resolved per repo (project row → org default → `task-types.yaml`) | per task-type (× repo) |

Hierarchy: **Factory ⊃ Floor(s) ⊃ AssemblyLines ⊃ Stations ⊃ Agents.**

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

Current-code mapping:

| Term | Today's code |
|---|---|
| Floor | `apps/floor` (the `lore-floor` deployment) |
| AssemblyLine | the assembly line YAML + supervisor graph (`@re-cinq/lore-assembly-lines`) |
| Station | the claude-runner Job pod / the local runner sandbox |
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
  `taskQueue()`, `settings()`, `usage()`, `jobRuns()`, `evalRuns()`, `cost()`,
  `contextCore()`, `research()`, `baseline()`, `chunks()`, `memoryLifecycle()`)
  that binds the shared `Pg…` adapter to the pool — the established
  `eventQueue()`/`auditLog()` pattern.
- **One home per table.** Each port ships a port interface + Pg adapter (SQL
  lifted byte-for-byte) + InMemory behavioral double + colocated test. The
  Floor-local `kernel/repositories/*` halfway house was deleted.
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
