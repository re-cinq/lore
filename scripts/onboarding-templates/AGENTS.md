# Agent Instructions

## Task Tracking
- Call `ready_tasks` (MCP) at the start of every session to see unblocked work
- Call `claim_task` (MCP) before starting any task
- Call `complete_task` (MCP) when a task is complete
- Never work on a task already claimed by someone else

## Context
- Org and team context are loaded automatically via Lore MCP
- If context seems stale, run: `git -C ~/.re-cinq/lore pull`

## Workflow
- For new features: use `/lore-feature`
- For PR descriptions: use `/lore-pr`
- For task delegation: use `create_pipeline_task` via MCP
