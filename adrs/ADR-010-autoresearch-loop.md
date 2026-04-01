---
adr_number: "010"
title: Autoresearch loop for self-improving context quality
status: accepted
date: 2026-04-01
domains:
  - architecture
  - agents
  - self-improvement
---

# Autoresearch loop for self-improving context quality

## Status

Accepted

## Context

Context quality was static — no automated mechanism to detect knowledge gaps from actual usage or improve context based on feedback. The constitution (Phase 3) described an autoresearch loop but it was designed around Klaus (removed) and BigQuery/OCI bundles (not deployed). Langfuse already traces low-confidence queries and PromptFoo evals already exist per team.

## Decision

Implement 3 new Lore Agent scheduled jobs:

1. **eval-runner** (nightly 3am): Run PromptFoo evals, store results in pipeline.eval_runs, create tasks for >5% regressions
2. **autoresearch** (weekly Monday 6am): Query Langfuse for low-confidence traces, cluster by similarity, generate 3 candidate approaches (direct/example/constraint) per gap, eval each, open PR for >= 2% improvement or create task for manual review
3. **context-core-builder** (nightly 4am): Compare current context quality to baseline, promote improvements >= 2%, reject regressions > 5%

## Rationale

- **Builds on existing infrastructure** (Langfuse tracing, PromptFoo evals, pipeline tasks, GitHub PRs)
- **Eval-driven decisions** prevent content quality regression
- **Three candidate approaches** maximize chance of finding useful content
- **Human review via PRs** ensures quality — agents propose, humans approve
- **Graceful degradation** — all jobs skip cleanly when Langfuse or PromptFoo are not configured

## New Infrastructure

- 3 PostgreSQL tables: `pipeline.eval_runs`, `pipeline.research_attempts`, `pipeline.context_core_history`
- No external services added

## Alternatives Considered

### 1. Full Klaus-based autoresearch

Original design required BigQuery, OCI bundles (oras), Artifact Registry, and FalkorDB. Over-engineered for current scale. The simplified version uses existing PostgreSQL tables.

### 2. Manual gap detection

Quarterly review of support tickets. Too slow, misses patterns, doesn't scale.

### 3. LLM-only quality assessment

Skip PromptFoo and have the LLM judge its own context. Circular reasoning — the model can't evaluate what it doesn't know.
