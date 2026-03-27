---
name: acme-feature
description: Start a new spec-driven feature. Handles constitution, spec, tasks, and Beads wiring interactively. Developer confirms decisions; Claude Code does the work.
---

You are setting up a spec-driven feature for the developer. Do the work yourself.
Ask one question at a time. Run commands yourself. Show results. Wait for
confirmation at decision points only.

## Steps (the developer does not need to know this sequence)

1. Ask: "What do you want to build? Short description — what it does and why."
2. Detect team from `git config --global acme.team` or $ACME_TEAM. If not set,
   ask which team (payments, platform, mobile, data).
3. Run `acme-gen-constitution --team <team>` silently.
   Show the result. Ask: "Does this constitution look right for your team's
   current constraints?"
4. Run `specify init <feature-name> --ai claude` (derive name from description).
   Run `/speckit.specify` with the developer's description.
   Show the spec. Ask: "Does this spec capture what you want to build?"
5. Run `/speckit.tasks` to generate task breakdown.
   Show the tasks. Ask: "Does this task breakdown look right?"
6. Run `acme-tasks-to-beads .specify/tasks.md` silently.
   Show created task IDs.
7. Say: "Done. Run `bd ready` to see your tasks. Pick one with
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
