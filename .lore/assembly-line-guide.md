# What a new assembly line needs

A plan that adds or changes an assembly line is only implementable if every
piece below either exists already or has a task that builds it. The planning
agent, `plan-validate` and `spec-write` read this list; each item a plan
relies on but the repository lacks becomes its own task in tasks.md. Written
after the issue-triage plan (#2257, 2026-09-29) named six node outcomes, a
task type, eight labels and a label-waiting gate that did not exist, and its
first task's PR failed CI on it.

## The definition

- The graph is YAML at `libs/assembly-lines/src/assembly-lines/<name>.yaml`,
  loaded by `libs/assembly-lines/src/loader.ts`: `name`, `entry`, `exit`,
  `nodes`, `edges`. Every non-exit node needs an edge for each outcome its
  type can produce (or an `always` edge), and a back-edge needs
  `iteration_max` unless the cycle passes a human station.
- A new line's name joins the pinned list in
  `libs/assembly-lines/src/loader.test.ts` ("loads all bundled assembly
  lines"), or CI fails.

## Outcomes: what an edge can route on

Edges route only on `success`, `changes_requested`, `failed` or `always`
(`EdgeCondition` in `libs/assembly-lines/src/assembly-line-schema.ts`). What
each node type can produce is fixed in `PRODUCIBLE_OUTCOMES` there: an
`agent` node produces `success`, `changes_requested` or `failed`, nothing
else. A plan that branches on its own verdicts (`obsolete`, `large-issue`,
`unable-to-reproduce`) must either map each verdict onto those three outcomes
and say which, or plan the schema change that adds outcomes (the enum,
`PRODUCIBLE_OUTCOMES`, edge selection in `libs/assembly-lines/src/transition.ts`,
and their tests) as a task that comes first.

## Nodes

- **Agent node**: its `prompt_ref` must name an agent definition, shipped as
  `libs/shared/src/agent-defaults/<prompt_ref>.md` (frontmatter = settings,
  body = prompt; seeded into `lore.agent_definitions` at lore-api boot).
  `libs/assembly-lines/src/prompt-refs.test.ts` fails CI for an agent node
  whose recipe does not exist. Each new recipe is a task: what the agent is
  told, what it writes, and how it reports its outcome.
- **Station node** (not an agent): the node type must be in `NodeType` and
  `PRODUCIBLE_OUTCOMES`, and needs a station module in
  `apps/stations/src/work/<name>/` (a manifest declaring `runtime: service`
  or `pod`, plus the code that does the work). "A service station that closes
  the issue" is new code, not a YAML edit.
- **Human station** (a person decides, the run parks): only
  `feature_review`, `pr_review` and `ci_check` exist
  (`libs/assembly-lines/src/human-station.ts`). Waiting on anything else, an
  issue label for instance, needs a new entry there, a manifest in
  `apps/stations`, and the code that resumes the parked run when the thing
  happens (a webhook handler or a sweep). Each is a task.

## Task types and triggers

- A task that runs a line has a task type: add it to `TaskTypeSchema`
  (`libs/shared/src/domain/models/pipeline-task.ts`) and to a tier in
  `TRUST_LEVELS` (`libs/shared/src/domain/pipeline-task-trust.ts`); a task
  type no tier lists is refused at creation. No task type is created from a
  description any more: a run is started by code, a tick sweep under
  `apps/stations/src/work/` or a handler in the stations drain.
- GitHub triggers (labels, comments, pull-request events) are answered in
  `apps/stations/src/events/repo-handlers.ts` and
  `apps/stations/src/events/floor-review-handlers.ts`.

## GitHub labels

A label a line applies must already exist in the target repository: the
issues station refuses unknown labels, and GitHub's create-issue silently
adds them to the repo's taxonomy. Creating a label set, and the code that
applies each label on each outcome, are tasks.

## Tasks that share a file

Tasks that edit the same file conflict when they run side by side. Chain them
with `(depends on …)` in the order they build on each other; the spec-task
executor also refuses to run two tasks of a group together that edit one
file, or where either lacks `[P]`.
