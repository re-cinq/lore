---
name: lore-feature
description: Start or continue implementing a feature. Works with existing specs (from PM feature requests) or creates new ones. Guides you through spec → plan → tasks → implement interactively.
---

You are helping a developer implement a feature. Do the work yourself.
Ask one question at a time. Run commands yourself. Wait for confirmation
only at decision points.

## Two entry points

### Entry A: Feature already has a spec (PM created it via Lore)

1. List available specs: `ls specs/` and show them.
2. Ask: "Which feature do you want to work on?" (or they already told you)
3. Read the spec: `specs/{feature}/spec.md`
4. Read the tasks: `specs/{feature}/tasks.md` (if exists)
5. Read the data model: `specs/{feature}/data-model.md` (if exists)
6. Show a summary: what the feature does, how many tasks, which are done.
7. Ask: "Ready to start? I'll work through the tasks in order."

### Entry B: New feature (no spec yet)

1. Ask: "What do you want to build? Short description — what and why."
2. Load repo context via `get_context` (Lore MCP) to understand conventions.
3. Create the feature directory: `specs/{slug}/`
4. Write `specs/{slug}/spec.md` — problem statement, user scenarios,
   functional requirements, success criteria. Match the style of existing
   specs in this repo.
5. Show the spec. Ask: "Does this capture what you want?"
6. Write `specs/{slug}/tasks.md` — checklist format:
   ```
   - [ ] T001 [P] Description with file path
   - [ ] T002 Description with file path
   ```
   Organized by phase. Mark parallelizable tasks with [P].
   Include actual file paths from the repo structure.
7. Show the tasks. Ask: "Does this breakdown look right?"
8. Commit the spec files: `git add specs/{slug}/ && git commit`

## Implementation flow (both entry points)

Once the spec and tasks exist:

1. Create a feature branch: `git checkout -b feat/{slug}`
2. Find the first uncompleted task in `tasks.md`
3. Show: "Working on T{N}: {description}"
4. Implement the task — write code, create files, modify existing code.
   Follow the repo's conventions from CLAUDE.md.
5. After completing the task, mark it done in tasks.md:
   Change `- [ ] T{N}` to `- [x] T{N}`
6. Commit the changes with a clear message referencing the task.
7. Ask: "T{N} done. Continue to T{N+1}?" (or let them review first)
8. Repeat until all tasks are done or developer stops.

When all tasks are done:
- Show summary of what was built
- Suggest: "Ready to open a PR? Use /lore-pr to draft the description."

## Rules

- ALWAYS read the spec and tasks before implementing anything.
- ALWAYS mark tasks as [x] in tasks.md after completing them.
- ALWAYS commit after each task (atomic commits, not one big commit).
- If a task is unclear, ask one specific question before proceeding.
- If you discover the spec is wrong or missing something, say so and
  suggest an update. Don't silently deviate.
- Follow the repo's code conventions (from CLAUDE.md) exactly.
- Use `search_context` (Lore MCP) if you need to understand org patterns.
- Use `search_memory` (Lore MCP) to check if others worked on related things.

## Start

If the developer said what they want to build, go to Entry B.
If they didn't specify, check if `specs/` has features and show them (Entry A).
If `specs/` is empty and they didn't describe anything, ask:
"What do you want to build? Give me a short description — what it does and why."
