---
adr_number: 29
title: "Feature spec → user-story/task decomposition: a post-merge in-process agent"
status: draft
date: 2026-06-18
domains: [agent, pipeline, web-ui]
---

# ADR-029: Feature spec decomposition

This ADR adds a feature-decompose agent that runs in-process when a feature's spec PR merges, turning the merged spec into a user-story-to-task tree — one GitHub Issue per story plus spec-task rows wired into the existing implementation pipeline.

> **Amendment 2026-08-13 — decomposition is the tail of ONE feature line, not a
> separately-triggered run.** Two decisions below are superseded: "Trigger: automatic,
> on spec-PR merge" (which mints a `feature-decompose` task) and "In-process in the
> coordinator, not a Station" (which predates the station cutover). The *outputs* —
> a story/task tree, Issues per story, `spec-task` rows — are unchanged.
>
> **What went wrong.** The trigger was a task-type predicate:
> `decompose-kick.ts` fires only when a
> merged PR belongs to a `feature-finalize` task. Once finalize became a *resume* of the
> feature-planning line (features.ts)
> the owning task is `feature-planning`, the predicate stops matching, and **decomposition
> never starts** — silently, with nothing logged. Every feature planned on the merged line
> is affected.
>
> **The replacement.** feature-planning.yaml
> gains a `merged` node of type `wait` with `signal: pr_merged`, followed by the
> `decompose` and `issues` nodes lifted from
> `feature-decompose.yaml`,
> which is retired. One line now spans the whole feature lifecycle:
>
> ```
> analyze → author(wait: author_feedback) → analyse-specs → write → push
>         → merged(wait: pr_merged) → decompose → issues → done
> ```
>
> **Why a wait node rather than a fixed predicate.** The `pr_merged` signal is already
> declared in the loader's `WaitSignal` union
> and already rendered by the run
> visualization as "Waiting for the spec PR"
> ([run-node-status.ts](../apps/web-ui/src/lib/run-node-status.ts)) — no definition had
> ever used it. The seam existed; this uses it. A person merging a PR is a station in
> exactly the sense ADR-027's `author` node already established: the moments a human acts
> become steps in the graph rather than gaps between runs.
>
> **The trigger becomes a resume, not an insert.**
> [merge-check.ts](../apps/stations/src/work/merge-check/merge-check.ts) resolves the line via
> `findOpenByPr` ([assembly-lines-port.ts](../libs/shared/src/outbound/project/assembly-runs/assembly-runs-port.ts))
> and reports to the parked node with an `assembly_run.resume` event, handled by the
> existing resume-event-handler.ts.
> That is the same mechanism finalize already uses, so no new event type is introduced and
> `decompose-kick.ts` is deleted rather than corrected. This depends on the `push` node
> stamping `pr_number` on the line — `findOpenByPr` cannot resolve a line whose PR was
> never recorded.
>
> **Execution moved to a pod.** "In-process in the coordinator" was superseded by the
> station cutover (ADR-031): `decompose` is an agent node and `issues` is a station
> ([issues.ts](../apps/stations/src/planning/file-issues/issues.ts)) reaching the database over
> HTTP, so the coordinator-credentials argument below no longer applies.
>
> **Alternative rejected.** Keep two lines and widen the kick predicate to also match a
> `feature-planning` task whose line reached `push`. It repairs the symptom but leaves two
> rows describing one feature's progress, which every reader — UI, retrospective, cost
> accounting — then has to correlate by `feature_id`.
>
> **Migration.** A line resolves its definition at start, so features already in flight on
> the two-line shape settle on the old path. No data migration.


## Amendment 2026-09-21: decomposition keys on plans

Decomposition is unchanged, but its spec-tasks no longer name a feature row: the `issues` station stamps `plan_id` and `spec_path` into each spec-task's `context_bundle`, and the spec-status flip reads the path from there (ADR-047). `specTasksForFeature` is gone with the feature page that read it.

## Amendment 2026-10-07: spec-task rows are gone; a plan's tasks are tickets

This ADR's mechanism — one `spec-task` row per decomposed task, grouped by the
run that filed them, dispatched by a reader of that table — is removed. The
dispatcher it relied on, the spec-task executor, ran every minute with no
per-repository opt-in and no way to switch it off, and it opened pull requests
against a repository whose implementation loop was deliberately switched off
(`specs/external-floor` FR15.0).

What survives is everything this ADR decided about ISSUES: one story issue per
plan, one issue per task, filed idempotently against the plan's markers, linked
as sub-issues, with the story's checklist rewritten. What goes is the row beside
each issue. The `issues` station now stamps a priority label on each task issue
instead, so the backlog implementation loop queues it — one at a time per
repository, behind `settings.implementation_loop.enabled`
(`specs/7-feature-planning` FR-11.13).

The `tasks.md` parser named in the Context below (`syncTasksToDb`, `parseTasks`,
`inferPhaseDependencies`) is deleted with it; its `[DEPENDS ON: ...]` and `[P]`
markers now reach people as the `Depends on #<n>` lines in a task issue's body
and nothing else. The loop does not honour that order — CI and review judge a
task started early.

## Context

Smart feature planning (ADR-027) ends at a merged `specs/<slug>/spec.md` PR plus,
optionally, a single whole-feature "user story" Issue. Nothing turns that spec
into implementable work. The planning prompt
(`planning-instructions.ts`)
deliberately refuses to break the feature into user stories or tasks and defers
that to "a separate downstream agent" — but that agent did not exist. The result:
a planned feature stalls after the spec lands; the handoff from *what we're
building* to *the units that build it* was unbuilt.

A task pipeline already exists: `spec-task` rows in `pipeline.tasks` (with
`depends_on` / `phase` / `parallelizable` / `file_path` metadata) are picked up by
the implementation pipeline under the per-repo trust gate. Today those rows are
created only from a hand-authored `specs/<slug>/tasks.md` parsed on merge
(`syncTasksToDb`, [merge-check.ts](../apps/stations/src/work/merge-check/merge-check.ts)),
and only for the legacy one-shot `feature-request` task type. The interactive
planning flow produces no `tasks.md`, so it feeds nothing.

## Decision

**Add a `feature-decompose` agent that runs in-process when a feature's spec PR
merges, reading the merged spec and producing a user-story → task tree: one
GitHub Issue per story plus `spec-task` rows wired into the existing
implementation pipeline.**

- **Trigger: automatic, on spec-PR merge.** The same merge detection that syncs
  `feature-request` spec-tasks (`merge-check` cron + the spec-PR webhook) also
  kicks a `feature-decompose` task `{feature_id, slug}` when a `feature-finalize`
  PR merges. Idempotent on `(repo, spec_slug)` — a re-merge or replay never
  duplicates stories or tasks (the same guard `syncTasksToDb` already uses).
- **In-process in the coordinator, not a Station.** Unlike planning/finalize
  (which clone + commit in a pod, ADR-028), decomposition is an LLM analysis whose
  side effects — creating Issues and `pipeline.tasks` rows — are coordinator-side
  and need the coordinator's DB + GitHub credentials. A pod would have to POST the
  result back for the coordinator to persist anyway, so it runs directly in the
  worker via `Llm.instance`, like the in-process planning handler.
- **Output is a story/task tree (`DecompositionResult`).** The agent returns an
  ordered list of user stories, each with a summary, acceptance criteria, and its
  implementable tasks (id, description, `depends_on`, `phase`, `parallelizable`,
  `file_path`). The contract lives in
  [decomposition-result.ts](../libs/shared/src/domain/feature-planning/decomposition-result.ts),
  parsed leniently (same drift tolerance as `GapResult`); an invalid result fails
  the task.
- **Stories → Issues, tasks → `spec-task` rows.** Each story becomes a GitHub
  Issue (`User story: <title>`, labels `lore-managed`/`user-story`, body links the
  spec + feature), unless the repo's dark-factory `create_issue` policy resolves to
  never — then tasks-only, honoring the PR-canonical philosophy of ADR-016. Each
  task becomes a `spec-task` row carrying its story Issue number + `feature_id`, so
  the existing implementation pipeline and trust gate run them unchanged.
- **Prompt + model from the agent definition.** `feature-decompose` is a row in
  `lore.agent_definitions` (editable org default, project override) seeded by
  migration, resolved by name like `feature-planning` (ADR-027). The offline
  fallback is the `DECOMPOSITION_INSTRUCTIONS` constant.
- **Lifecycle: additive, no new feature status.** The feature stays `pr-open`; the
  decomposition is linked by `feature_id` on the tasks and by reference on the
  Issues, so the Features tab can surface the tree without a schema/status change.

## Consequences

- The planning → implementation gap closes: a merged feature spec now yields the
  stories and tasks that the existing pipeline implements, with no hand-authored
  `tasks.md`.
- Two creators of `spec-task` rows now coexist: `tasks.md` sync (feature-request)
  and the decomposition agent (feature-planning). Both share the row shape and the
  `(repo, spec_slug)` idempotency guard, so they cannot double-create.
- Decomposition quality depends on spec quality; a thin spec yields thin tasks.
  The agent definition is editable so the prompt can be tuned per org/project.
- Story Issues are gated by the dark-factory `create_issue` policy, so dark-mode
  repos still get the tasks without Issue noise.
