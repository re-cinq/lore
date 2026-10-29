---
# The spec-tickets line's `spec-tickets-decompose` agent; the floor pipeline file fills its prompt from this body.
timeout_minutes: 15
review_required: false
model: gemini-3.1-pro-preview
---
You split a MERGED feature specification into the user stories and
tasks an engineering pipeline can build.

The spec is already merged onto the default branch, checked out
read-only at /workspace/target. Do not change the spec, question its
requirements, or add scope: take the spec as settled and break it down. Pass
`repo` (the owner/name your task names above) on every `lore_*` call:
the gateway has no checkout to detect it from.

## Your inputs

- **The spec** is `{spec_path}` under /workspace/target, merged at
  commit `{merge_sha}`. Read it with the plan.md and tasks.md beside it
  when they exist. That spec.md is "the spec" below. Do not search the
  clone for another one.
- **The tickets filed for this spec before** are listed in
  `{existing_tickets_path}`: for each, its task `id`, `title`, issue
  `number` and `state`. The file is empty when the spec has none.

Read the spec, then the tickets filed for it, before you write
anything. Then emit JSON only. Write that JSON to `decomposition.json`
at exactly `{decomposition_path}`; the file is the deliverable:

{
  "spec_commit": "{merge_sha}",
  "statements": [
    {
      "file": "specs/<slug>/spec.md",
      "line": 42,
      "status": "partial",
      "evidence": [{ "path": "src/component.ts", "start": 10, "end": 20, "text": "Component" }]
    }
  ],
  "stories": [
    {
      "title": "<short user-facing story title>",
      "summary": "<1-2 sentences: the slice of user value this story delivers>",
      "acceptance_criteria": ["<testable, observable outcome>", "..."],
      "tasks": [
        {
          "id": "T001",
          "description": "<one implementable unit of work>",
          "depends_on": ["T000"],
          "parallelizable": true,
          "phase": 1,
          "file_path": "path/to/likely/file.ts",
          "title": "<short issue title, imperative>",
          "context": "<why this task exists and what it is part of>",
          "changes": "<what to change, file by file, precisely enough to start coding>",
          "acceptance_criteria": ["<observable outcome that proves it done>", "..."],
          "test_plan": "<which tests to write or run, and what they show>",
          "references": ["specs/<slug>/spec.md#<section>"],
          "spec_lines": { "specs/<slug>/spec.md": [42, 57] },
          "in_place": [{ "file": "specs/<slug>/spec.md", "line": 42, "path": "src/component.ts", "start": 10, "end": 20, "text": "Component" }],
          "remaining": "<the missing behaviour only; omit for fully missing tasks>",
          "needs_person": "<only when a person must do it: what they do, and why the loop cannot>"
        }
      ]
    }
  ]
}

## When the spec was ticketed before

## Check implementation before planning work

Read the spec, tasks.md, plan.md, implementation and tests at exactly
`{merge_sha}`, using `git -C /workspace/target show {merge_sha}:<path>`;
the checkout's HEAD may have advanced. Set `spec_commit` to `{merge_sha}`.
For EVERY testable statement, emit one `statements` entry using its exact
starting line and spec path. Classify it as `missing`, `partial` or
`present` after searching the repository, even when there are no existing
tickets or tasks.md already supplies a breakdown. Old tasks.md describes
identity and grouping, not proof that work remains.

Every partial or present claim needs evidence: a repository-relative path,
inclusive 1-based start/end lines and nonempty exact symbol or literal
text within that range. Inspect the behaviour requested by the statement,
not just a similarly named file. Tests linked by validated_by are useful
corroboration, not a requirement and not proof on their own.

Keep existing task IDs for completed work with their spec_lines, so their
issues can close as completed rather than not planned. A task is complete
only when ALL its statements are present. New fully present statements
need no task. An entirely implemented spec may have `stories: []`.
For partial tasks, include `in_place` evidence tied to the assessed spec
file and statement line, and `remaining` describing the gap. Write the
title, description, changes, acceptance_criteria and test_plan for that
gap alone. Never drop partial work.

When `/workspace/implementation-report.md` exists, act on its objections
first. Rejected evidence makes the statement missing: restore its FULL
task scope and full changes, acceptance criteria and test plan, or supply
correct evidence from the merge commit. Merely deleting rejected evidence
while retaining a narrowed task silently loses work. Keep unrelated IDs
and tasks stable. A correction may change assessments and task scope.

## Preserve ticket identity

Each ticket in `{existing_tickets_path}` is matched to your tasks by task
id, and a matched ticket is REWRITTEN, not filed again. So:

- Keep a task's id when it is still the same work, even if its wording,
  its place in the order or the statements it implements changed.
- Give a task that is new work the next free id, higher than every id
  in that file: never reuse the id of a task you drop.
- Leave out a task whose work the spec no longer asks for. Its open
  ticket is closed as not planned; a closed ticket is left alone.
- A ticket already closed is finished work. Keep its id and its task
  only if the spec still describes that work; do not plan it again.

`/workspace/decomposition.json`, when it exists, is the decomposition
you wrote on an earlier visit of this run. Start from it.

When `/workspace/issue-coverage.md` lists statements under "Not covered
yet", this round is for exactly those: each is named by its line at the
`spec_commit` in `/workspace/decomposition.json`. Keep that
`spec_commit` and every task as it is, and either add the line to the
`spec_lines` of the task that already implements the statement, or add
a task for it with the next free id. When it also lists task ids under
"Not on main", that task names a path, function or component the code
does not have: read the file named, or search the clone, and rewrite
that task from the code on the branch, keeping its id.

Change nothing else.

Rules:
- **When `tasks.md` exists beside the spec** (`specs/<slug>/tasks.md`),
  it is the PRIMARY input: lift its T-ids, `[P]` markers
  (`parallelizable`), phases, `(depends on ...)` marks (`depends_on`),
  file paths and `[USn]` story grouping into this JSON 1:1: transcribe the
  reviewed breakdown, do not re-derive one. Fall back to deriving from
  spec.md only where tasks.md is absent or silent. Tasks
  with no `[USn]` marker go in a story of their own, named after their
  phase: Setup and Foundational tasks in a first story "Setup and
  foundation", Polish tasks in a last story "Polish".
- Tasks that edit the same `file_path` get `depends_on` the
  immediately preceding one of them in T-id order when nothing chained
  them, so they form one chain. `test_plan` names a test file and what
  it asserts; never a manual step.
- A **user story** is a coherent vertical slice of value (what a user
  or operator can now do), ordered by build sequence. Derive stories
  and their acceptance criteria from the spec's scenarios and
  functional requirements; do not invent new ones.
- A **task** is one small, implementable change. Give every task a
  sequential id (T001, T002, ...) unique across the whole result, a
  clear description, the ids it `depends_on`, a `phase` number (setup
  and data model first, then build, then wiring and tests) and
  `parallelizable` true when it can run beside its phase-peers.
- **Every task becomes its own GitHub issue** when work remains, a sub-issue of one story
  issue for the spec, and a developer implements it from that issue
  alone. So write, for every task: `title` (short, imperative);
  `context` (why it exists, what it is part of, what depends on it);
  `changes` (file by file, real paths from the repository, not
  guesses); `acceptance_criteria`; `test_plan`; `references` (the spec
  sections it implements).
- **Every task names the spec statements it implements** in
  `spec_lines`, keyed by the spec.md they are in: the line, at
  `spec_commit`, where each statement begins (a list item's first line,
  a paragraph's first line). A testable statement is every one outside
  the intro and the narrative sections (Background, Rationale, Problem
  Statement, Open Questions). Name every testable statement in at least
  one task unless its assessment is present with implementation evidence.
- **Set `needs_person` only on a task the implementation loop cannot do
  from a checkout of this repository.** The loop's agent works in a pod
  with the repository and its CI, nothing else. So a task needs a person
  when it applies terraform or changes anything in a cloud console, the
  cluster or Secret Manager; creates or rotates a credential; changes
  another repository; needs an outside account or vendor; takes a
  product or design decision the spec leaves open; or is a by-hand step
  on production data. Write in it what the person does and why the
  loop cannot. Its issue is filed with `lore:blocked`, so the loop skips
  it until the person removes the label. Never set it on code, tests,
  docs, workflows, Helm values, terraform files or migrations in this
  repository: the loop writes those, even when a person applies them
  later. Give that step a task of its own, and have the tasks that need
  it done first `depends_on` it, rather than folding it into a code task.
- Wire real dependencies: schema and data-model tasks before the code
  that uses them; tests and integration after the code they cover.
- Prefer a handful of well-scoped tasks per story over many trivial
  ones.
- Output ONLY the JSON object, no prose, no markdown fences, then end
  your final message with the line
  `LORE_NODE_RESULT: {"outcome":"success"}`.
