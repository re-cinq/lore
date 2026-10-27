---
name: lore-context
description: Use this repo's Lore context. Before changing code, query the live lore_ MCP tools (lore_assemble_context, lore_search_context, lore_search_memory) for conventions, ADRs, prior decisions, and past learnings; before finishing, record any non-obvious learning with lore_write_memory so future runs benefit.
---

This agent runs with a live Lore MCP connection — the `lore_*` tools are available.

**Before you change anything:**

1. Call `lore_assemble_context` (or `lore_search_context`) with a query describing the
   task, to load the repo's conventions, ADRs, and prior decisions.
2. Call `lore_search_memory` for relevant past learnings and gotchas — someone may
   have already solved this or hit a trap.

**Before you finish:** if you discovered something non-obvious — a gotcha, a design
decision, a correction to earlier assumptions — record it with `lore_write_memory`
(or `lore_write_episode` for raw observations), so the next run starts warmer. This is
how an agent session feeds its learnings back into shared memory.
