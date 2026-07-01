---
adr_number: 31
title: "Agent / Station / AgentDefinition as Kubernetes CRDs — the production execution substrate (replaces LoreTask)"
status: accepted
date: 2026-06-25
domains: [agent, pipeline, infra, governance, web-ui]
---

# ADR-031: The ai-agent-subsystem is the production execution substrate

> **Cutover complete.** The legacy `LoreTask` path — the CRD + controller, the
> `claude-runner` image, the `RoutingStationBackend` cutover router, the per-repo
> `execution.backend` opt-in, and the Docker/local Station backend — has been
> **removed**. agent-cr is now the only execution path.

> **Revises the earlier draft of ADR-031** (which scoped the CRDs as a *standalone, greenfield,
> not-wired-to-production* experiment). This version adopts the subsystem as the **production**
> execution substrate and **supersedes [ADR-011](./ADR-011-loretask-crd-ephemeral-execution.md)**
> (the `LoreTask` CRD) and the **storage** decision of
> [ADR-030](./ADR-030-agent-definition-recipe-and-tool-seam.md).

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
do context hydration, validation, commit/push, PR creation, retry, or multi-node workflows.

We now decide to make it Lore's production substrate. The incumbent `LoreTask` →
`loretask-controller` → `lore-claude-runner` path (ADR-011) is retired; the **Floor becomes the
orchestrator** and the Lore-specific glue is **relocated Floor-side** where it must stay
deterministic.

## Decision

Run all Floor task execution on the `ai-agent-subsystem`. CRDs in group **`agents.re-cinq.com`**
(`v1alpha1`), namespace **`ai-agents`**. The decision is recorded as D1–D8; the rollout is tracked by
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
  `permission_mode`, `max_turns`, `resources`, `output`, `tool_config`). No image / no compute.
- **`Station`** — the running context: `agentDefRef` + an embedded Kubernetes `PodTemplateSpec`
  (image, CPU/memory, volumes, security) + deadline + history limits + concurrency policy.
- **`Agent`** — one run: `{ stationRef, taskId, targetRepo, branch, parameters }` →
  `status { phase, jobName, exitCode, output, prUrl, failureReason }`.

**D3 — Non-AI workflow steps reference GitHub Actions.** The engine runs `claude` directly, so Lore
does not inject an in-pod lint/typecheck kernel. The workflow separates concerns: **AI nodes run as
Agent CRs; non-AI deterministic steps (validate / build / lint / typecheck) reference the repo's
GitHub Actions** (a `github-action` workflow node), and the Floor-side graph gates on the run
**conclusion** — deterministic, because GitHub runs the repo's real toolchain. Repos without CI are
covered by onboarding scaffolding `lore-tests.yml`.

**D4 — The assembly line runs Floor-side.** `libs/runner`'s `executeAssemblyLine` (pure orchestration, no
Anthropic dependency) runs **in the Floor**; a new agent-node handler **dispatches one `Agent` CR per
agent-node and awaits its terminal status**, heartbeating the branch lease while it waits. Lease,
branch-as-state resume (commit trailers), and `iteration_max` are branch-centric and unchanged.

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
access** — a security upgrade.

**D8 — Observability.** `AgentDefinition.output.sinks = [stdout, http→Floor /api/agent-events]`; the
Floor parses the NDJSON into `pipeline.llm_calls` (cost), OTEL spans, GCS archival, and the UI log
viewer. Terminal `Agent.status` drives lifecycle / PR / curation.

**Orchestration boundary.** A new `AgentBackend` (the existing `StationBackend` port, alongside
`K8sLoreTaskClient` / `DockerStation`) creates `Agent` CRs; a Floor-side `agent-watcher` (replacing
`loretask-watcher`) computes changed files, reads the CI gate, opens the PR (`Lore-Task` footer),
auto-merges, and escalates. A two-gate flag (`settings.execution.backend` + a cluster env var) routes
tasks during a graded, reversible cutover.

## Alternatives rejected

- **Keep the in-tree TS `k8s/` PoC** (D1) — duplicates the D subsystem with a less-mature, unsigned
  build; deleted.
- **Postgres-only recipe store (ADR-030 storage)** — superseded; the CRD is the source of truth, the
  schema is generated into a code-API package so it can't drift.
- **An in-pod validation kernel** — the engine runs `claude` directly; deterministic validation is
  the repo's GitHub Actions, gated Floor-side (D3).
- **A static org-wide PAT in `agent-secrets`** — long-lived, org-wide blast radius; rejected for
  short-lived per-task App tokens (D6).
- **Big-bang LoreTask replacement** — rejected for a graded, reversible cutover with both controllers
  running in parallel; `LoreTask` is retired **last**.
- **Trusting the LLM to self-validate / self-merge** — rejected; the deterministic glue (CI gate, PR,
  auto-merge, escalation) lives Floor-side.

## Consequences

- **Positive.** Execution becomes a reusable, signed, standalone substrate with Kubernetes-native
  validation, `kubectl` visibility, and RBAC-gated writes. Deterministic guarantees (validation gate,
  PR, auto-merge, escalation, audit) are preserved Floor-side. Secrets and observability reuse the
  existing setup; run pods lose their DB credential. The model→adapter seam (ADR-030) leaves room for
  codex/cursor later.
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
  [`specs/floor-on-ai-subsystem/`](../specs/floor-on-ai-subsystem/spec.md); the glossary stays
  [`specs/glossary.md`](../specs/glossary.md).
