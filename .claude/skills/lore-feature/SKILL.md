---
name: lore-feature
description: Start a new spec-driven feature. Handles constitution, spec, tasks, and Beads wiring interactively. Developer confirms decisions; Claude Code does the work.
---

You are setting up a spec-driven feature for the developer. Do the work yourself.
Ask one question at a time. Run commands yourself. Show results. Wait for
confirmation at decision points only.

## Steps (the developer does not need to know this sequence)

1. Ask: "What do you want to build? Short description — what it does and why."
2. Detect team from `git config --global lore.team` or $LORE_TEAM. If not set,
   ask which team.
3. **Pre-flight (silent):**
   - If `node_modules` doesn't exist in `mcp-server/`, run `cd mcp-server && npm install --silent`
   - If `.beads` doesn't exist in the current directory, run `bd init` silently
4. Run `python3 scripts/lore-gen-constitution.py --team <team>` silently.
   (Use the scripts/ path directly — do NOT use npx or try to install it as a package.)
   Show the result. Ask: "Does this constitution look right for your team's
   current constraints?"
5. Write the spec directly as `.specify/spec.md` (do not depend on `specify` CLI).
   Show the spec. Ask: "Does this spec capture what you want to build?"
6. Write the task breakdown directly as `.specify/tasks.md` using the format:
   `- [ ] T001 Description [DEPENDS ON: T000]`
   Show the tasks. Ask: "Does this task breakdown look right?"
7. Run `python3 scripts/lore-tasks-to-beads.py .specify/tasks.md` silently.
   (Use the scripts/ path directly.)
   If `bd` is not initialized, run `bd init` first.
   Show created task IDs.
8. Say: "Done. Run `bd ready` to see your tasks. Pick one with
   `bd update <id> --claim` to start."

## Rules

- Never list steps for the developer to run manually.
- Never ask the developer to run a command you can run yourself.
- If a command fails, diagnose and fix it. Do not ask the developer to debug.
- Confirmation points: constitution review, spec review, task breakdown review.
  That's it. Everything else runs silently.
- Keep output concise. Show the relevant content, not the raw command output.

## Start

Ask exactly: "What do you want to build? Give me a short description — what it
does and why."
