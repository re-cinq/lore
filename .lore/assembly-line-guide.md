# What a new assembly line needs

A plan that adds or changes an assembly line is only implementable if every
piece below either exists already or has a task that builds it. The planning
agent, `plan-validate` and `spec-write` read this list; each item a plan
relies on but the repository lacks becomes its own task in tasks.md. Written
after the issue-triage plan (#2257, 2026-09-29) named six node outcomes, a
task type, eight labels and a label-waiting gate that did not exist, and its
first task's PR failed CI on it. Rewritten on 2026-10-02: every line runs on
the external floor ([re-cinq/floor](https://github.com/re-cinq/floor),
ADR-049), and the engine Lore ran itself is deleted.

## The definition

- A line is one YAML file at
  `libs/assembly-lines/src/floor-pipelines/<name>.yaml` with three blocks:
  `line` (its `id`, `entry`, `exit`, `args`, `nodes` and `edges`), `stations`
  (what each node's station needs, produces and can report) and
  `agent_definitions` (model, image, timeout and the prompt, inline, for each
  agent station).
- lore-api puts every file in that folder to the floor at boot
  (`apps/lore-api/src/work/floor/seed-floor-pipelines.ts`). A file's content
  is its version, so only a changed file becomes a new version.
- A new line's name joins the pinned list in
  `apps/lore-api/src/work/floor/seed-floor-pipelines.test.ts` ("declare the
  lines …"), or CI fails. The same test refuses an agent definition with an
  empty prompt.
- `${LORE_AGENT_IMAGE}`, `${LORE_MCP_URL}` and `${LORE_SKILLS_URL}` are filled
  from lore-api's environment when the file is put. A new placeholder needs
  code there and a chart value.

## Outcomes: what an edge can route on

A station declares its own outcomes (`outcomes:` under its entry in
`stations`), and an edge routes `on:` one of them or `always`. A line can
therefore branch on its own verdicts (`obsolete`, `large-issue`), as long as
the station that reports the verdict lists it and every listed outcome has an
edge or an `always` edge out of each node that uses the station. The floor
refuses a file that leaves an outcome with nowhere to go. A back-edge needs
`iteration_max` unless the cycle passes a human station.

## Stations

- **Agent station** (`kind: agent`): names an entry in `agent_definitions`.
  Its prompt is the body of `libs/shared/src/agent-defaults/<agent definition>.md`,
  filled in when the pipeline file is loaded (`withAgentPrompts`).
  Say what the agent is given (`needs`: a `git` checkout with `access: write`
  or `read`, a `file`, a `value`), what it writes (`produces`), and how it
  reports its outcome. A second writer on a branch must come after a human
  station on every path in.
- **Service station** (`kind: service`): code, not YAML. It is one folder under
  `apps/stations/src/<line>/<station>/`, written with `@re-cinq/floor-station`,
  started from that line's `index.ts` and registered in the service's
  composition root (`apps/stations/src/index.ts`). "A station that closes the
  issue" is a task with a test, and `layers.yaml` needs an entry for a new
  line folder.
- **Human station** (`kind: human`): the run parks until something reports an
  outcome to it. A person does (the plan editor, a pull-request review), or a
  sweep does on their behalf (`apps/stations/src/work/pr-ready-check/` answers
  the waits on CI). Waiting on anything new, an issue label for instance,
  needs the code that reports to the parked visit when the thing happens: a
  handler in the stations drain or a sweep. That code is a task.

## Starting a run

- No task type is created from a description, and no route starts a run by
  name. A run is started by code that calls the floor through
  `@re-cinq/floor-client` (`floor.lines.start`): a tick sweep under
  `apps/stations/src/work/` for scheduled or backlog work, or a handler in the
  stations drain for a GitHub event
  (`apps/stations/src/events/repo-handlers.ts`,
  `apps/stations/src/events/floor-review-handlers.ts`).
- A line declares the argument its runs are keyed on (`subject: true` under
  `line.args`). Two starts on the same subject share one open run, so say what
  the subject is: a task, a pull request, a plan, a repository.
- A scheduled start needs a cron emitter
  (`libs/shared/src/work/scheduler/cron-emitters.ts`) and a sweep that
  declares that tick as its trigger. Both are tasks.
- When the run settles, the `run-settled` station
  (`apps/stations/src/code-review/run-settled/`) is what tells Lore: closing a
  task, commenting on a ticket. A line whose end must change something in Lore
  needs its case there.

## GitHub labels

A label a line applies must already exist in the target repository: GitHub's
create-issue silently adds an unknown label to the repo's taxonomy. Creating a
label set, and the code that applies each label on each outcome, are tasks.

## Tasks that share a file

Tasks that edit the same file conflict when they run side by side. Chain them
with `(depends on …)` in the order they build on each other; the spec-task
executor also refuses to run two tasks of a group together that edit one
file, or where either lacks `[P]`.
