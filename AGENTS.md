# Agent instructions

## First session (new developer)

If this looks like the developer's first session (no Beads tasks, no recent
git activity in this repo), say:

"Welcome to [repo name]. I have your team's context loaded — conventions,
active decisions, and current work. A few things to know:

- `bd ready` shows what's available to work on
- `/lore-feature` sets up a new feature end-to-end
- `/lore-pr` drafts your PR description when you're done

Want me to show you what's currently unblocked?"

## Orientation

At the start of every session, check Beads task state:

- If a task is claimed: tell the developer which task is in progress and
  offer to continue.
- If no task is claimed: suggest running `bd ready` to see unblocked tasks.
- Never ask the developer to manually load context. MCP handles this.

## Starting a feature

If the developer mentions starting a new feature, building something new,
or picking up a ticket:

- Suggest `/lore-feature` before they do anything else.
- Do not ask them to run specify, lore-gen-constitution, or
  lore-tasks-to-beads separately. `/lore-feature` handles all of it.

## During implementation

- All context (org conventions, team patterns, ADRs) is loaded via MCP.
- All task state is tracked via Beads hooks.
- Do not ask the developer to provide context you already have.
- If uncertain about a convention, check MCP via get_context before asking.

## Finishing work

When the developer signals they are done with a piece of work:

- Confirm the Beads task should be marked done: `bd update <id> --status done`
- If the task had dependents, mention that they are now unblocked.

## Opening a PR

If the developer mentions opening a PR, creating a pull request, or
pushing for review:

- Suggest `/lore-pr` before they open a browser.
- Do not let them write the PR description from scratch if a spec exists.

## Delegating work to the cluster

Use `delegate_task` when:

- A task will take more than ~20 minutes (long tests, ingestion, gap analysis)
- The task is well-defined and does not need interactive decisions
- You want to keep the local session focused on something else

Do not delegate:

- Exploratory work that needs back-and-forth
- Tasks where the spec is not yet clear
- Anything that needs the developer's active judgment mid-task

Always pass context when delegating:

- beads_task_id if the task has a Beads entry
- spec_file: true if there is a .specify/spec.md
- seed_query with the topic being worked on

## Task tracking commands

Run these yourself. Do not ask the developer to remember them:

- `bd ready` — see unblocked tasks
- `bd update <id> --claim` — claim a task before starting
- `bd update <id> --status done` — mark complete
- `bd pull` — sync task state (SessionStart hook does this automatically)

## Never do

- Ask the developer to load context manually
- Ask the developer to remember the spec-driven workflow steps
- Ask the developer to write a PR description from scratch
- Suggest running lore-gen-constitution, /speckit.specify, /speckit.tasks,
  or lore-tasks-to-beads individually — `/lore-feature` handles all of these
