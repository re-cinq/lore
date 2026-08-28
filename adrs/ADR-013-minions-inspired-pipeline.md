---
adr_number: 13
title: "Minions-inspired task pipeline improvements"
status: draft
date: 2026-04-05
domains: [pipeline, agents, integrations]
---

# ADR-013: Minions-inspired task pipeline improvements

Adds Stripe-Minions-inspired quality gates to the task runner: deterministic lint/typecheck validation, a two-round fix retry cap, pre-run context hydration, per-directory convention rules, and a Slack task interface.

## Context

Stripe's Minions system produces 1,000+ merged PRs/week by treating
the task runner as an orchestrator that enforces deterministic quality
gates. Lore previously delegated all quality responsibility to Claude
Code agents, with zero validation between agent completion and
commit/push. Agents could push broken code that only CI would catch.

## Decision

Add four features inspired by Stripe Minions:

### 1. Deterministic validation

After the agent edits code, detect repo tooling and run lint/typecheck
as mandatory pipeline stages — not relying on the agent to remember.

- `repo-validation.ts` detects Node (package.json), Go (go.mod),
  Python (pyproject.toml), Rust (Cargo.toml)
- Validation scoped to changed files to avoid false positives
- Runs in both local runner (`monitorTask`) and GKE (`entrypoint.sh`)

### 2. Two-round retry cap

If validation fails, spawn a fix-only Claude Code pass with the error
output. Cap at one retry — no infinite loops. If still failing, mark
`needs-human-help` and preserve the worktree for debugging.

### 3. Pre-run context hydration *(reversed 2026-08-28)*

Fetch assembled context from the Lore API before spawning Claude Code.
The agent starts with conventions, ADRs, memories, and graph on turn 1
instead of spending its first action calling `lore_assemble_context`.
Reduces cold-start latency and ensures context is always loaded even
if the agent skips the required workflow.

**Amendment (2026-08-28): this is reversed. Nothing is fetched before a run.**
The fetch needed `LORE_INGEST_TOKEN`, which never leaves the central cluster, so
once runs could be claimed by satellite clusters the same recipe opened two
different ways depending on who claimed it — warm centrally, cold everywhere
else. Both `ContextSource` implementations and the local runner's copy are gone.

What replaces it is one constant, `CONTEXT_BOOTSTRAP`, in the `{context}` slot
the recipes already declare: an instruction to call `lore_assemble_context`
first. The original rationale survives inverted — an agent pod now holds a live
Lore MCP gateway for the whole run, so a self-assembled context is *better*
targeted than the dispatcher's guess (a 200-character slice of the description,
capped at 8000 tokens against a template budgeting 21,700). The cost is one turn.

"Always loaded even if the agent skips the workflow" was the one real loss, and
it was already lost: hydration was best-effort, and every satellite run had been
starting cold since claim-based dispatch shipped.

### 4. Subdirectory convention rules

Support `.claude/rules/*.md` files loaded conditionally during context
assembly. Rules are matched by keyword against the task query. Added
to all four templates at priority 1.

### 5. Slack integration

`/lore` slash command creates pipeline tasks from Slack. Watcher posts
PR links, issue links, and failure messages back to the originating
channel. Uses bot token (not response_url) because tasks can exceed
the 30-minute response_url TTL.

## Consequences

- Broken code is caught before push, not after CI (faster feedback)
- Agents get rich context on turn 1 (fewer wasted LLM calls)
- Convention rules can be scoped per directory (monorepo support)
- Slack becomes a first-class interface alongside UI and GitHub Issues
- `needs-human-help` is a new task status that surfaces in the UI
