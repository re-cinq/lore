---
adr_number: 14
title: "Intelligent memory lifecycle — passive capture, decay, consolidation"
status: accepted
date: 2026-04-06
domains: [memory, agents, pipeline]
---

# ADR-014: Intelligent memory lifecycle

## Context

Lore's memory system had three gaps: agents skipped explicit
`write_episode` calls (losing learnings), memories grew without
bounds (no eviction), and raw facts were noisy (no pattern synthesis).

Inspired by agentmemory (passive hooks, importance decay, session
diversification) and ByteRover (ACE auto-curation pipeline).

## Decision

### 1. Passive session capture

Track all MCP tool calls in-memory (`session-tracker.ts`, 500-entry
ring buffer). On exit, dump to `~/.lore/last-session.json`. Stop hook
POSTs to `/api/session-summary` for episode + fact extraction. Zero
agent cooperation needed.

### 2. Post-task auto-curation

After every task (PR, no-changes, failure, feature-request, onboard),
write an episode via `episode-writer.ts`. High-signal events get
Haiku lesson extraction → stored as `auto-curation/{ref}` memories.

### 3. Session diversification in search

Cap results to max 3 per source (agent_id + source combo) in RRF
merge. Prevents one verbose session from dominating search results.

### 4. Privacy filtering

`sanitizeContent()` strips API keys, JWTs, private keys, connection
strings, and bearer tokens before all memory writes (episodes,
memories, both MCP tool and REST API paths).

### 5. Importance-based memory decay

Daily job (5 AM) scores memories 0-10 based on:
- Recency: -1 per 30 days of age
- Content: short (<50 chars) penalized, long (>500) boosted
- Key pattern: decisions/conventions +2, auto-curation/sessions -1

Evicts lowest-scoring when agent exceeds 500 memories. Also cleans
invalidated facts older than 30 days beyond 2000 cap.

### 6. Automatic fact consolidation

Daily job (5:30 AM) groups recent facts (7-day lookback) by repo.
Calls Haiku to extract 1-3 higher-level patterns per repo. Stored
as `consolidated/{repo}/{timestamp}` memories. Requires minimum 5
facts to trigger. Turns noisy raw facts into actionable insights.

## Consequences

- Every session and task captured without agent action
- Memory grows bounded (importance decay prevents unbounded growth)
- Search results are diverse (session diversification)
- Raw facts evolve into patterns (consolidation)
- Secrets never stored in org-wide memory (privacy filtering)
- Daily Haiku cost: ~$0.15-0.60 for decay + consolidation combined
