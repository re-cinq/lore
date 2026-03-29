# Agent Instructions

## Task Tracking
- Run `bd ready` at the start of every session to see unblocked work
- Run `bd update <id> --claim` before starting any task
- Run `bd update <id> --status done` when a task is complete
- Never work on a task already claimed by someone else

## Context
- Org and team context are loaded automatically via Lore MCP
- If context seems stale, run: `git -C ~/.re-cinq/lore pull`

## Workflow
- For new features: use `/lore-feature`
- For PR descriptions: use `/lore-pr`
- For task delegation: use `delegate_task` via MCP
