---
adr_number: 31
title: "Agent / Station / AgentDefinition as Kubernetes CRDs (standalone k8s/ subsystem)"
status: accepted
date: 2026-06-18
domains: [agent, pipeline, infra, governance]
---

# ADR-031: Agent / Station / AgentDefinition as Kubernetes resources

## Context

ADR-030 modelled the **AgentDefinition** as a stored *recipe* and chose Postgres (`lore.agent_definitions`)
as its home, explicitly rejecting CRDs. We are reversing the **storage** decision (only): make
**Agent**, **Station**, and **AgentDefinition** first-class **Kubernetes Custom Resources**, and give
the new resources plus the program that runs them a single top-level **`k8s/`** folder.

The recipe *fields* ADR-030 designed are kept verbatim — they become the `AgentDefinition` CRD's
schema. What changes is *where the config lives* and *how a run is started*: declaring a Kubernetes
object instead of a DB row, reconciled by a controller into a Job.

This is built **greenfield and standalone**, *outside* the existing Lore + LoreTask pipeline. We do
not wire it into today's web UI / Postgres / local runner / Job pods, and we do not move the existing
charts/terraform. Replacing `LoreTask` with `Agent` in production and integrating the current
consumers are explicit **later** efforts.

## Decision

Three CRDs in group `lore.re-cinq.com`, version `v1alpha1`, each with a `status` subresource:

- **`AgentDefinition`** — the recipe (config). `spec` = the ADR-030 field set (`model`, `prompt`,
  `allowed_tools`, `disallowed_tools`, `permission_mode`, `max_turns`, `resources`, `output`,
  `tool_config`). `prompt` is a **template** containing `{placeholder}` strings. **No image / no
  compute** — those are the Station's.
- **`Station`** — the running context (config). `spec` = `{ agentDefRef, deadlineMinutes, template,
  successfulRunsHistoryLimit, failedRunsHistoryLimit }`, where **`template` is an embedded Kubernetes
  `PodTemplateSpec`** (the idiomatic way a custom kind "extends" a Pod — the same mechanism
  Deployments/Jobs use; declared with `x-kubernetes-preserve-unknown-fields: true`). Image, CPU/memory,
  volumes, sidecars, and security live in standard Pod fields of that template.
- **`Agent`** — one run. `spec` = `{ stationRef, taskId, targetRepo, branch, parameters }`; `status` =
  `{ phase, jobName, startedAt, completedAt, exitCode, output, prUrl, failureReason }`.

**Wiring.** An `Agent` references only a `Station`; the `Station` references the `AgentDefinition`.
`AgentDefinition` + `Station` are created **once and reused** (config); an `Agent` is created **per run**
and carries only `parameters` (which fill the recipe's `{placeholder}`s via a pure
`renderPrompt(template, params)`).

**Controller.** A new standalone controller (templated on the existing `LoreTask` controller) watches
`Agent` CRs and reconciles each: follow Station → AgentDefinition, stamp a Job from the Station's Pod
template (wiring the named `agent` container's command/env from the recipe + rendered prompt), write
`status`, and — CronJob-style — TTL-delete the finished Job (`ttlSecondsAfterFinished`) while pruning
finished `Agent` records beyond the Station's history limits.

**Launching a run.** An in-cluster app creates an `Agent` CR via the Kubernetes API (a
`launch-agent` client helper modelled on `apps/floor/src/adapters/k8s-loretask.ts`). The run id is the
Agent's `metadata.name` (returned on create); query with `getAgent(name)`, watch with
`watchAgent(name)`, or look up by your own key via labels + `findAgents(labelSelector)`. Runs are
event-driven (a webhook/queue/app creates the CR per event), not time-driven.

## Alternatives rejected

- **Postgres store (ADR-030)** — superseded for these three concepts; the recipe *schema* is retained.
- **Moving everything (web UI / Postgres / runner / existing charts) onto CRDs now** — deferred; this
  subsystem is standalone so it can be built and proven without touching production.
- **Replacing `LoreTask` immediately** — deferred; `Agent` will supersede it later.
- **A warm-pool Station you `exec` into** — Stations are ephemeral (one Job per Agent); launching =
  creating an `Agent` CR.

## Consequences

- A new top-level `k8s/` folder holds the CRDs, the controller, an in-cluster client, RBAC/NetworkPolicy,
  deploy manifests, examples, and a local `kind` harness.
- The config gains Kubernetes-native validation (`openAPIV3Schema`), `kubectl` visibility, RBAC-gated
  writes, and declarative apply — without the controller having to implement storage.
- ADR-030's recipe types (`libs/shared/src/project/agents/{agent-defs-port,agent-resources,agent-output}.ts`)
  are reused as the CRD schema / controller types (type-only reuse; no runtime dependency on the rest
  of Lore). The Postgres recipe work from ADR-030 is left in place but not extended, pending the later
  integration/replacement decision.
- **Deferred (separate efforts):** the real coding-agent image inside the Job (first version uses a
  trivial image to prove the loop); replacing `LoreTask`; the project→org→yaml recipe merge; and wiring
  the existing consumers. See [`specs/glossary.md`](../specs/glossary.md).
