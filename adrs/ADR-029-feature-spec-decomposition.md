---
adr_number: 29
title: "Feature spec → user-story/task decomposition: a post-merge in-process agent"
status: shipped
date: 2026-06-18
domains: [agent, pipeline, web-ui]
---

# ADR-029: Feature spec decomposition

## Context

Smart feature planning (ADR-027) ends at a merged `specs/<slug>/spec.md` PR plus,
optionally, a single whole-feature "user story" Issue. Nothing turns that spec
into implementable work. The planning prompt
([planning-instructions.ts](../libs/shared/src/feature-planning/planning-instructions.ts))
deliberately refuses to break the feature into user stories or tasks and defers
that to "a separate downstream agent" — but that agent did not exist. The result:
a planned feature stalls after the spec lands; the handoff from *what we're
building* to *the units that build it* was unbuilt.

A task pipeline already exists: `spec-task` rows in `pipeline.tasks` (with
`depends_on` / `phase` / `parallelizable` / `file_path` metadata) are picked up by
the implementation pipeline under the per-repo trust gate. Today those rows are
created only from a hand-authored `specs/<slug>/tasks.md` parsed on merge
([syncTasksToDb](../apps/mcp-server/src/features/pipeline/tasks.ts),
[merge-check.ts](../apps/floor/src/application/jobs/scheduled/merge-check.ts)),
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
  [decomposition-result.ts](../libs/shared/src/feature-planning/decomposition-result.ts),
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
