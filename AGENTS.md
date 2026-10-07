# Agent instructions

## Commit hygiene (Lore-managed branches)

When working on a Lore-managed branch in this repo or any onboarded repo, every commit you author must carry the
structured trailer block at the end of the commit message body:

```
Lore-Stage: <stage-name>
Lore-Iteration: <int>
Lore-Task: <uuid>
```

These trailers are the audit substrate. Use `formatTrailers()` from
`@re-cinq/lore-shared`. Never `--amend`, `git commit --fixup`, force-push, or
rebase a branch that carries trailers — the lifecycle relies on the commit
log being append-only.

PR bodies must include the `Lore-Task: <uuid>` line so the web-ui can
resolve PR ↔ task. Use `prFooter()` from `@re-cinq/lore-shared`.

## First session (new developer)

If this looks like the developer's first session (no pipeline tasks, no recent
git activity in this repo), say:

"Welcome to [repo name]. I have your team's context loaded — conventions,
active decisions, and current work. A few things to know:

- `lore_ready_tasks` (MCP) shows what's available to work on
- `/lore-feature` sets up a new feature end-to-end
- `/lore-pr` drafts your PR description when you're done

Want me to show you what's currently unblocked?"

## Orientation

At the start of every session, check pipeline task state via MCP:

- If a task is claimed: tell the developer which task is in progress and
  offer to continue.
- If no task is claimed: call `lore_ready_tasks` to see unblocked tasks.
- Never ask the developer to manually load context. MCP handles this.

## Starting a feature

If the developer mentions starting a new feature, building something new,
or picking up a ticket:

- Suggest `/lore-feature` before they do anything else.
- Do not ask them to run specify, lore-gen-constitution, or
  lore_sync_tasks separately. `/lore-feature` handles all of it.

## During implementation

- All context (org conventions, team patterns, ADRs) is loaded via MCP.
- All task state is tracked via pipeline MCP tools.
- Do not ask the developer to provide context you already have.
- If uncertain about a convention, check MCP via `lore_assemble_context` before asking.

## Finishing work

When the developer signals they are done with a piece of work:

- Confirm the task should be marked done: call `lore_complete_task` via MCP.
- If the task had dependents, mention that they are now unblocked.

## Opening a PR

If the developer mentions opening a PR, creating a pull request, or
pushing for review:

- Suggest `/lore-pr` before they open a browser.
- Do not let them write the PR description from scratch if a spec exists.

## Handing work to an agent

There is no tool that creates a task from a description. Work reaches an agent
through one of these:

- **Code**: a ticket in the repository's backlog. Put a `priority:*` label on
  the issue (a `lore` or `lore:implementation` label gives it one) and the
  implementation loop picks it up.
- **A feature**: a plan (`/repos/<owner>/<repo>/plans`). Once it is approved its
  tasks are filed as issues carrying a priority label, so the same loop picks
  them up one at a time.
- **A review**: opening the pull request starts one where `auto_review` is on;
  `@lore review` asks for one by hand.

For work on your own machine, `lore_run_task_locally` runs it in a worktree and
tracks it locally only.

## Task tracking

Run these yourself via MCP. Do not ask the developer to remember them:

- `lore_ready_tasks` — see unblocked tasks
- `lore_claim_task` — claim a task before starting
- `lore_complete_task` — mark complete
- Pipeline tasks sync automatically via PostgreSQL (no manual pull needed)

## Never do

- Ask the developer to load context manually
- Ask the developer to remember the spec-driven workflow steps
- Ask the developer to write a PR description from scratch
- Suggest running lore-gen-constitution, /speckit.specify, /speckit.tasks,
  or lore_sync_tasks individually — `/lore-feature` handles all of these

## Landing the Plane (Session Completion)

**When ending a work session**, you MUST complete ALL steps below. Work is NOT complete until `git push` succeeds.

**MANDATORY WORKFLOW:**

1. **File issues for remaining work** - Create issues for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **PUSH TO REMOTE** - This is MANDATORY:
   ```bash
   git pull --rebase
   git push
   git status  # MUST show "up to date with origin"
   ```
5. **Clean up** - Clear stashes, prune remote branches
6. **Verify** - All changes committed AND pushed
7. **Hand off** - Provide context for next session

**CRITICAL RULES:**
- Work is NOT complete until `git push` succeeds
- NEVER stop before pushing - that leaves work stranded locally
- NEVER say "ready to push when you are" - YOU must push
- If push fails, resolve and retry until it succeeds
