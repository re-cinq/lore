---
adr_number: 14
title: "Passive memory capture and post-task auto-curation"
status: accepted
date: 2026-04-06
domains: [memory, agents, pipeline]
---

# ADR-014: Passive memory capture and post-task auto-curation

## Context

Lore agents were expected to call `write_episode` before session end,
but they often skipped it — losing valuable learnings. Only task
failures were automatically captured as episodes. Successful outcomes
(PRs, research results, onboarding) were not captured at all.

Inspired by agentmemory's passive hook-based capture (12 Claude Code
hooks, zero-cooperation memory) and ByteRover's ACE auto-curation
pipeline (Executor/Reflector/Curator phases after task completion).

## Decision

### 1. Passive session capture (MCP server)

Track all MCP tool calls in an in-memory ring buffer
(`session-tracker.ts`, 500 entries). On process exit (SIGTERM, SIGINT,
beforeExit), dump to `~/.lore/last-session.json`. The Stop hook reads
this file and POSTs to `/api/session-summary`, which stores it as an
episode with automatic fact extraction.

This captures session activity without any agent cooperation.

### 2. Post-task auto-curation (agent)

After every pipeline task completion, automatically write an episode
via `episode-writer.ts`:

- **PR created**: episode with PR URL, changed files, description.
  Haiku extracts a lesson learned → stored as `auto-curation/{ref}`.
- **No changes**: episode with task output (research results).
- **Failure**: episode with failure reason and output. Haiku extracts
  a lesson learned.
- **Feature request**: episode with PM intent and generated artifacts.
- **Onboarding**: episode with generated files list.

Curation uses Claude Haiku (~$0.002/call) and is best-effort.

## Consequences

- Every session and task outcome is now captured without agent action
- Fact extraction runs on all captured episodes (contradiction detection)
- Auto-curation memories are searchable via `search_memory`
- Session tracking adds negligible overhead (in-memory array, no I/O)
- Haiku curation cost: ~$0.10-0.50/day at current task volume
