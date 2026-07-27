---
adr_number: 31
title: "Agent / Station / AgentDefinition as Kubernetes CRDs — the production execution substrate (replaces LoreTask)"
status: draft
date: 2026-06-25
domains: [agent, pipeline, infra, governance, web-ui]
---

# ADR-031: The ai-agent-subsystem is the production execution substrate

This ADR adopts the standalone ai-agent-subsystem as Lore's production execution substrate, modeling Agent, Station, and AgentDefinition as Kubernetes CRDs and retiring the LoreTask path, with the Floor orchestrating an event-driven assembly-line walk where every node runs as its own pod.

> **Cutover complete.** The legacy `LoreTask` path — the CRD + controller, the
> `claude-runner` image, the `RoutingStationBackend` cutover router, the per-repo
> `execution.backend` opt-in, and the Docker/local Station backend — has been
> **removed**. agent-cr is now the only execution path.

> **Revises the earlier draft of ADR-031** (which scoped the CRDs as a *standalone, greenfield,
> not-wired-to-production* experiment). This version adopts the subsystem as the **production**
> execution substrate and **supersedes [ADR-011](../graveyard/adrs/ADR-011-loretask-crd-ephemeral-execution.md)**
> (the `LoreTask` CRD) and the **storage** decision of
> [ADR-030](./ADR-030-agent-definition-recipe-and-tool-seam.md).

> **Revised 2026-07:** node execution was generalized so **every** assembly-line node — not just
> agent nodes — runs as an `Agent` CR in its own pod. Non-LLM nodes are "stations" (ADR-024) run by
> a new `exec` vendor. This is folded into D2–D4, D7, and D9 below.

> **Revised 2026-07 (2): the walk is event-driven.** The Floor no longer runs an in-process
> polling walk (a fire-and-backgrounded promise died with the pod — PR #805's run proved it).
> Node CRs carry `assembly-line-id`/`node-id` labels; their terminal phases emit
> `kubernetes.agent_node.{succeeded,failed}` (deduped PER CR — the old per-task dedupe swallowed
> every node after the first); a transition handler records the outcome (CAS) and re-derives the
> next launch/finish purely from `pipeline.assembly_line_nodes` (`nextTransition` replay). A
> per-minute reaper is the liveness bound (timeouts, relaunches, dropped/dead-lettered events).
> Branch lease + stage-commit resume are retired on this path — the stage commits were local-only
> and never pushed, so git-log resume was a fiction in production; DB uniqueness
> (UNIQUE (line, node, iteration)) + event dedupe are the concurrency control. Folded into D4
> below; spec FR6.7/FR6.9/FR6.10. Alternatives rejected: a reaper+resume patch keeping the
> in-process walk (user chose the full rearchitecture); a per-transition lease (duplicates what
> the unique index already guarantees). Note: detect runs DO carry a (synthetic) task-id label —
> the earlier claim they don't was stale.

## Context

[ADR-030](./ADR-030-agent-definition-recipe-and-tool-seam.md) designed the **AgentDefinition** recipe
and the **AgentTool** seam but stored the recipe in Postgres (`lore.agent_definitions`). The first
draft of this ADR turned the three concepts (Agent / Station / AgentDefinition) into Kubernetes CRDs
but built them **greenfield and standalone**, explicitly deferring the production cutover and the
`LoreTask` replacement.

Since then a clean-sheet operator — **`ai-agent-subsystem`** (`re-cinq/ai-agent-subsystem`, written
in D, statically linked, signed/SBOM'd images) — has matured to a releasable state. It is a **pure
execution engine**: given an `Agent` CR (→ a `Station` PodTemplate, → an `AgentDefinition` recipe) its
controller stamps a Job whose pod clones the repo, runs `claude --print --output-format stream-json`,
streams NDJSON to sinks, detects the terminal `result`, and patches `Agent.status`. It does **not**
do context hydration, validation, commit/push, PR creation, retry, or multi-node assembly lines.

We now decide to make it Lore's production substrate. The incumbent `LoreTask` →
`loretask-controller` → `lore-claude-runner` path (ADR-011) is retired; the **Floor becomes the
orchestrator** and the Lore-specific glue is **relocated Floor-side** where it must stay
deterministic.

## Decision

Run all Floor task execution on the `ai-agent-subsystem`. CRDs in group **`agents.re-cinq.com`**
(`v1alpha1`), namespace **`ai-agents`**. The decision is recorded as D1–D9; the rollout is tracked by
epic [#690](https://github.com/re-cinq/lore/issues/690).

**D1 — Substrate: the D standalone subsystem is production.** Production runs on
`ai-agent-subsystem` (`agents.re-cinq.com` / `ai-agents`; signed images; supervisor + initializer;
its own CI). The earlier in-tree **TypeScript `k8s/` PoC** (`lore.re-cinq.com` / `lore-agents`,
busybox example) is **deleted** — two half-built substrates do not coexist.

**D2 — The CRDs are the source of truth.** `AgentDefinition` + `Station` + `Agent` objects live in
the cluster and are authoritative. The **web UI edits the recipe YAML and applies it to Kubernetes**
(no DB round-trip); ADR-030's Postgres recipe store (`lore.agent_definitions`) is **retired**. The
recipe *schema* and the AgentTool seam from ADR-030 are **retained** as the CRD `openAPIV3Schema` and
runtime contract, **generated from the D structs** into a published code-API package
(`@re-cinq/agent-contracts`) that the Floor and the web UI both import — so no consumer re-derives the
shapes (subsystem [#82](https://github.com/re-cinq/ai-agent-subsystem/issues/82)). The three CRDs:
- **`AgentDefinition`** — the recipe (`model`, `prompt` template, `allowed_tools`, `disallowed_tools`,
  `permission_mode`, `max_turns`, `resources`, `output`, `tool_config`). No image / no compute. A
  station recipe sets `model: exec` and carries its argv in `tool_config.command` (D9).
- **`Station`** — the running context: `agentDefRef` + an embedded Kubernetes `PodTemplateSpec`
  (image, CPU/memory, volumes, security) + deadline + history limits + concurrency policy.
- **`Agent`** — one run: `{ stationRef, taskId, targetRepo, branch, parameters }` →
  `status { phase, jobName, exitCode, output, prUrl, failureReason }`.

**D3 — Non-AI assembly line steps run as station pods; `github_action` nodes gate on CI.** The engine
runs `claude` directly, so Lore injects no in-pod lint/typecheck kernel into *agent* pods. Deterministic
work is separated out into its own pods: **non-agent nodes (`validate` / `gate` / `retrospective` /
`detect`) run as station pods** — the `lore-station` image via the `exec` vendor (D9), not `claude`.
The one CI-backed variant is the **`github-action`** node, which references the repo's real GitHub
Actions with the Floor-side graph gating on the run **conclusion** — deterministic, because GitHub runs
the repo's toolchain. Repos without CI are covered by onboarding scaffolding `lore-tests.yml`.

**D4 — The assembly line runs Floor-side, event-driven (revised 2026-07 (2)).** The Floor
dispatches one `Agent` CR per node — agent or station (D9) — and **advances the line on the CR's
terminal `kubernetes.agent_node.*` event**; a per-minute reaper (`cron.assembly_line_reaper.tick`)
is the liveness bound for timeouts, unlaunched nodes, and dropped events. There is no walker
process, no clone, no branch lease, and no stage commits on this path: the walk state IS
`pipeline.assembly_line_nodes` (FR6.9), `iteration_max` is enforced by replaying the rows
(`nextTransition`), and pod-death survivability is inherent. CR names key on the per-attempt
assemblyLineId (`<assemblyLineId:12>-<nodeId>`, with `-<iteration>` appended on revisits, FR6.5)
so two attempts of one task never collide;
the CR spec keeps `taskId` for the watcher/reaper label probes and adds the full
`assembly-line-id`/`node-id` labels the event mapping reads.

**D5 — Context hydration.** The Floor injects assembled context into `Agent.spec.parameters` at
dispatch (deterministic, turn-1); code-editing recipes also declare the Lore MCP server for
interactive lookups.

**D6 — Secrets inherit the existing setup.** The `ai-agents` namespace gets its secrets by ESO
mirroring the **same** GCP Secret Manager remoteRefs the Floor already uses (`ANTHROPIC_API_KEY`, the
GitHub App credentials, ingest/internal tokens, Slack) into `agent-secrets` — **no new secret
material**. The **per-task GitHub token** is still minted from the existing App: the Floor PATCHes a
short-lived per-task key into `agent-secrets` and removes it on terminal status (RBAC restricted by
`resourceNames: ["agent-secrets"]`). No long-lived org PAT.

**D7 — Networking.** Self-hydration and telemetry go over the **public LB** (port-443 egress is
allowed by the run-pod NetworkPolicy, which blocks RFC1918/metadata). Run pods **drop direct Postgres
access** — a security upgrade. **Station pods included** (D9): they reach data through the Project facade
over HTTP-backed adapters against `LORE_API_URL`, never Postgres.

**D8 — Observability.** `AgentDefinition.output.sinks = [stdout, http→Floor /api/agent-events]`; the
Floor parses the NDJSON into `pipeline.llm_calls` (cost), OTEL spans, GCS archival, and the UI log
viewer. Terminal `Agent.status` drives lifecycle / PR / curation.

**Orchestration boundary.** A new `AgentBackend` (the existing `StationBackend` port, alongside
`K8sLoreTaskClient` / `DockerStation`) creates `Agent` CRs; a Floor-side `agent-watcher` (replacing
`loretask-watcher`) computes changed files, reads the CI gate, opens the PR (`Lore-Task` footer),
auto-merges, and escalates. A two-gate flag (`settings.execution.backend` + a cluster env var) routes
tasks during a graded, reversible cutover.

**D9 — Non-agent nodes are stations.** Every non-agent node type (`validate`, `gate`, `retrospective`,
`github_action`, `detect`, and custom types) dispatches its own `Agent` CR and runs in a pod,
generalizing D4 from agent-only to all node types. No new CRD, no `@re-cinq/agent-contracts` change.
- **The `exec` vendor** (ai-agent-subsystem `vendors/exec/`): the literal model id `exec` routes to a
  non-LLM adapter that spawns the recipe's `tool_config.command` argv with the rendered prompt appended.
  `tool_config` is an existing preserve-unknown-fields passthrough, so the contracts package is untouched.
- **Station recipes** are `AgentDefinition` / `Station` pairs named `def-<node type>`, seeded from
  `scripts/task-types.yaml` `stations:` by gen-catalog (org rows in `lore.agent_definitions` with
  `execution_mode: 'station'`, image two-key gated). The prompt template is literally `{station_input}`;
  the Floor's `nodeStationSpec` puts the node's JSON input in `Agent.spec.parameters.station_input`, so
  the pod's argv ends with it. Builtins ship in ONE image (`ghcr.io/re-cinq/lore-station`,
  `apps/lore-station/`, argv-selected); custom stations are any image honoring the contract, referenced
  from node YAML via `station_ref` (default `def-<node type>`).
- **Output contract** ([`station-contract.md`](../specs/6-dark-factory/contracts/station-contract.md)):
  NDJSON on stdout ending with the claude-style
  `{"type":"result","is_error":false,"result":"LORE_NODE_RESULT: {…}"}` line — the supervisor's existing
  terminal detection (D8) and `Agent.status.output` capture carry it, and the Floor's `parseNodeResult`
  maps it to the node outcome. `outcome:"failed"` is a NORMAL result (routes the assembly line's failed
  edge); `is_error` / non-zero exit / deadline are infrastructure failures → CR `Failed` →
  `station-failed`.
- **Timeouts.** The Station's `deadlineMinutes` (validate 15) is the pod's hard stop; a node-level
  `timeout_minutes` bounds the Floor's await (`maxPolls = timeout + 2min buffer`, so the deadline kill is
  observed, not raced) → `station-timeout`.
- **Data access (D7 holds).** Stations reach data through the Project facade over HTTP-backed adapters
  against `LORE_API_URL` — no Postgres from pods. **Auto-merge stays Floor-side**: merge authority never
  rides in a run pod; the Floor triggers it after a retrospective node succeeds.
- **Cutover complete.** Every non-agent node on the Floor-assembly-line path now dispatches a
  station unconditionally; the transitional `LORE_STATION_NODES` per-type flag and the in-process
  node handlers on that path are removed. The detector cores moved to `@re-cinq/lore-shared/detect`
  (facade-driven), so the detect node dispatches a `def-detect` station too — since the 2026-07 (2)
  revision, detection lines ride the same event-driven walk as every other line (the dedicated
  `run-detect` runner was retired). The last in-process execution
  path — the gap-fill/runbook JSON supervisor (`processTaskViaSupervisor` / `createProductionHandlers`,
  which cloned in-Floor with an App token and ran the LLM node in-process) — is now also removed:
  gap-fill runs on the Floor AssemblyLine (per-node Agent CRs) and runbook (no assembly-line YAML) as a
  single Agent CR, both dispatched through the ordinary `handleClaudeCodeTask` path. Completion detection
  stays the poll loop — detect runs carry no task-id label, so the `kubernetes.agent.*` watch mapper skips them;
  labeling CRs with the assembly-line id and extending the mapper is the noted follow-up.

## Alternatives rejected

- **Keep the in-tree TS `k8s/` PoC** (D1) — duplicates the D subsystem with a less-mature, unsigned
  build; deleted.
- **Postgres-only recipe store (ADR-030 storage)** — superseded; the CRD is the source of truth, the
  schema is generated into a code-API package so it can't drift.
- **An in-pod validation kernel injected into the agent pod** — the engine runs `claude` directly and
  gets no lint/typecheck kernel; deterministic validation runs as its own station pod (D9) or references
  the repo's GitHub Actions, gated Floor-side (D3).
- **A static org-wide PAT in `agent-secrets`** — long-lived, org-wide blast radius; rejected for
  short-lived per-task App tokens (D6).
- **Big-bang LoreTask replacement** — rejected for a graded, reversible cutover with both controllers
  running in parallel; `LoreTask` is retired **last**.
- **Trusting the LLM to self-validate / self-merge** — rejected; the deterministic glue (CI gate, PR,
  auto-merge, escalation) lives Floor-side.
- **A structured `Agent.status` field for node outcomes** (D9) — rejected; the `LORE_NODE_RESULT` result
  line reuses the existing terminal-detection + `status.output` path with no controller / contracts change.
- **Keeping non-agent nodes in-process in the Floor** (D9) — rejected; running every node as its own pod
  gives custom stations, per-node isolation, and per-node timeouts uniformly.

## Consequences

- **Positive.** Execution becomes a reusable, signed, standalone substrate with Kubernetes-native
  validation, `kubectl` visibility, and RBAC-gated writes. Deterministic guarantees (validation gate,
  PR, auto-merge, escalation, audit) are preserved Floor-side. Secrets and observability reuse the
  existing setup; run pods lose their DB credential. The model→adapter seam (ADR-030) leaves room for
  codex/cursor later — and, via the `exec` vendor (D9), for non-LLM stations: every assembly-line node
  now runs as its own isolated, timed pod, and third parties can supply custom station images against a
  published contract.
- **Cost / migration.** A 10-ticket effort (epic [#690](https://github.com/re-cinq/lore/issues/690)):
  generate the code-API package + cut subsystem **v0.3.0**; deploy via Helm in the existing
  `terraform apply`; `AgentBackend` + router; `agent-watcher`; UI-authored catalog + hydration +
  per-task token; observability sink; the Floor-side assembly line; a graded cutover; and a docs
  sweep. During migration the `loretask-controller` and `agent-controller` run in parallel (distinct
  groups/namespaces/pod-labels); `LoreTask`, the `claude-runner` image, and the cluster-wide
  `loretask-agent` RBAC are torn down only after a soak + rollback window.
- **Supersedes.** ADR-011 (LoreTask CRD execution) and ADR-030's *storage* decision. ADR-030's recipe
  schema, AgentTool seam, output fan-out, and security gating are retained as the CRD schema /
  runtime contract. The full design + acceptance criteria live in
  [`specs/floor-on-ai-subsystem/`](../specs/floor-on-ai-subsystem/spec.md); the station image / output
  contract in [`specs/6-dark-factory/contracts/station-contract.md`](../specs/6-dark-factory/contracts/station-contract.md);
  the glossary stays [`specs/glossary.md`](../specs/glossary.md).

## Amendment (proposed 2026-07-16): the `internal.ingest.*` family becomes an ingest station

**Status: accepted 2026-07-17 — Option 1 (label-scoped dgraph egress) chosen.** The graph-ingestion outage recovery exposed the last
substantive work still running inside the Floor process: the `internal.ingest.*` event
handlers. Docs projection (`spec_trace` kinds `specs`/`adrs`), test-report/coverage
ingest (dgraph writes on every CI push), and the post-ingest `spec_coverage_validate`
pass all execute in-process — predating this ADR's cutover, which covered assembly-line
nodes and the detection family but not the post-ingest lane. Every failure mode of
2026-07-16 (handlers outliving the 600s stuck-row reaper, uncancellable zombie passes,
serial-family starvation on a hung network call) is what stations exist to prevent: one
pod per unit of work, its own deadline, kill actually kills. Self-chunking (lore #855)
bounds the in-process handlers to seconds, but the architectural home is a station.

**Shape.** A new builtin `ingest` station type in the `lore-station` image runs the
existing shared cores (`dispatchSpecTrace` → `runIngestGraph` / `ingestTestReport` /
`ingestCoverageReport` / `validateSpecCoverageJob`) one event-payload per pod, dispatched
as a single-node detect-shaped assembly line so it rides the standard walk, timeout, and
reaper machinery. The Floor's `internal.ingest.*` handlers shrink to "start the line with
the event payload"; the post-ingest validate path dispatches the same station the weekly
detect line already uses instead of running the core inline. Episode auto-curation's
in-process Haiku call is a later candidate (retrospective-station duty), not in scope.

**The D7 decision (Option 1 chosen, 2026-07-17):**

1. **Scoped dgraph egress (CHOSEN).** The run-pod NetworkPolicy grants egress to
   `lore-dgraph-alpha.lore-dgraph.svc:8080` ONLY for pods of the ingest station type
   (label-scoped). The projector code stays unchanged. Justification: the station runs
   the signed, deterministic `lore-station` binary — no repo code, no LLM — so the
   unauthenticated in-cluster dgraph is exposed to a fixed, audited code path rather
   than to arbitrary agent workloads; D7's intent (agent pods can't reach internal
   state) is preserved.
2. **Graph writes proxied through lore-api (rejected).** New authenticated write
   endpoints mirroring `dgraph-upsert.ts` (~8 mutation shapes), projector ported to
   the facade. Keeps D7 byte-pure; costs a new write surface on the API, double
   network hops on every mutation, and a second copy of the transaction/retry
   semantics — rejected for surface and duplication over a label-scoped policy hole
   confined to a signed, deterministic, no-repo-code station image.

**Consequences.** The Floor becomes pure orchestration (its remaining handlers are
GitHub ceremony and event routing — deliberately Floor-side: merge authority never rides
in a pod); ingest gains per-chunk isolation, hard deadlines, and horizontal headroom;
`SERIAL_FAMILIES` shrinks back to empty once no in-process dgraph writers remain.
Detailed FRs/AC belong to a speckit feature under `specs/` when this amendment is
accepted; scope note lives in
[`specs/spec-traceability-graph/spec.md`](../specs/spec-traceability-graph/spec.md) open question 8.
