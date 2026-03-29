---
adr_number: "007"
title: Replace Klaus with purpose-built Lore Agent service
status: accepted
date: 2026-03-29
domains:
  - architecture
  - agents
  - pipeline
---

# Replace Klaus with purpose-built Lore Agent service

## Status

Accepted

## Context

Klaus (Giant Swarm's Claude Code agent runtime) was used as the cluster agent for pipeline tasks. Production use revealed several fundamental issues:

- **Output wrapping** in unpredictable layers (`result_text` + code fences) made response parsing unreliable
- **Model parameter rejection** — Klaus rejected or silently dropped model configuration
- **Session protocol fragility** — lost callbacks on pod restarts with no recovery mechanism
- **No direct repo access** requiring complex pre-fetch workarounds to get source code into the agent

These issues compounded in practice: 7+ manual retries were needed to onboard a single repo.

## Decision

Replace Klaus with **lore-agent**, a purpose-built TypeScript service that calls the Anthropic API directly via the official SDK.

## Rationale

- **Direct API control** over model, prompt, and response parsing — no black-box intermediary
- **Predictable JSON output** with no wrapping layers to unwrap
- **Built-in cost tracking** per call via the Anthropic SDK usage metadata
- **Consolidated scheduling** — replaces 5 K8s CronJobs with a single scheduler backed by DB persistence and missed-run recovery
- **Same security model** — single-replica service in GKE using Workload Identity, no new attack surface

## Supersedes

- Constitution Principle 7 "Klaus in GKE" row
- Constitution Principle 9 "Klaus agents" references

## Alternatives Considered

### 1. Fix Klaus output parsing

Attempted 4 times. The fundamental issue is black-box output wrapping — Klaus adds layers (`result_text`, code fences, session metadata) that vary between versions and cannot be reliably stripped. Not a fixable bug but an architectural mismatch.

### 2. Fork Klaus

Forking would give us control over the output format, but carries the full maintenance burden of a Claude Code runtime we do not need. A purpose-built service that calls the Anthropic API directly is simpler and more maintainable.

### 3. Use Anthropic tool_use for structured output

Viable approach — define a tool schema and let the model return structured data via `tool_use` blocks. Adds complexity (tool definitions, tool result handling) with no clear benefit over simple JSON instruction prompting, which works reliably with Haiku.
