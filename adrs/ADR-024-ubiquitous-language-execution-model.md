---
adr_number: 24
title: "Ubiquitous language for the execution model: Factory / Floor / AssemblyLine / Station / Agent"
status: accepted
date: 2026-06-15
domains: [agent, pipeline, ux, governance]
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
| **AssemblyLine** | a workflow of Stations with distinct responsibilities that hand off / wait on each other | per task |
| **Station** | the unit that runs exactly one Agent (a K8s Job pod, or a local sandbox/worktree) | per task-run |
| **Agent** | one ephemeral run of the Claude CLI/API + a prompt (context + task) | per Station |

Hierarchy: **Factory ⊃ Floor(s) ⊃ AssemblyLines ⊃ Stations ⊃ Agents.**

- **"Agent" is reserved** for sense #1 (the Claude-plus-prompt run). It is never
  the pod, the coordinator, or the workflow.
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
| AssemblyLine | the `workflow` YAML + supervisor graph (`@re-cinq/lore-runner`) |
| Station | the claude-runner Job pod / the local runner sandbox |
| Agent | the `claude --print` / `Llm` invocation |

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
