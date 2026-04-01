---
adr_number: "009"
title: Pipeline tasks replace Beads for developer task tracking
status: accepted
date: 2026-04-01
domains:
  - architecture
  - developer-workflow
  - tasks
---

# Pipeline tasks replace Beads for developer task tracking

## Status

Accepted

## Context

Beads (`bd` CLI) was the developer-facing task tracker with Dolt-based multi-developer sync. After Beads and Dolt were removed (due to Dolt integration complexity and `bd` CLI instability), tasks.md became dead markdown with no execution system behind it. The pipeline task system in PostgreSQL already had atomic claiming via `SELECT ... FOR UPDATE SKIP LOCKED` but had no developer-facing interface.

## Decision

Extend the existing pipeline task system with 4 new MCP tools: `sync_tasks` (parse tasks.md and upsert to DB), `ready_tasks` (list unblocked tasks), `claim_task` (atomic claim), `complete_task` (mark done, report unblocked dependents). Task dependencies from `[DEPENDS ON: ...]` annotations in tasks.md are enforced — a task is not "ready" until all its dependencies are complete.

## Rationale

- **Reuses existing pipeline.tasks table** — no new database, no new sync protocol
- **PostgreSQL provides stronger consistency** than Dolt's CRDT model
- **MCP tools integrate directly with Claude Code** — no separate CLI to install
- **Dependency tracking is enforced at query time**, not client-side

## Supersedes

- All `bd` CLI workflows
- Dolt remote deployment
- lore-tasks-to-beads.py script

## Alternatives Considered

### 1. Rebuild Beads with Dolt

Dolt's SQL interface and CRDT semantics were powerful but added an entire database system (dolt-sql-server) to operate. The pipeline DB already exists.

### 2. GitHub Issues only

No atomic claiming, no dependency tracking, pull-to-refresh model. Causes duplicate work in multi-developer teams.

### 3. Linear/Jira integration

External dependency, API rate limits, no MCP integration. Over-engineered for spec-driven task lists.
