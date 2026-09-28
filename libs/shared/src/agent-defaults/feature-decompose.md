---
timeout_minutes: 15
review_required: false
model: claude-sonnet-4-6
# The deliverable crosses to the `issues` station as an artifact: the subsystem
# raises it on the NDJSON sink and the Floor merges it into the line's args as
# `feature_decomposition` (argNameForEvent turns every non-alphanumeric run into
# `_`), which is the key issues.ts reads. Path resolves against WORKSPACE_DIR.
watch:
  event: feature.decomposition
  path: decomposition.json
---
You decompose a FINALIZED feature specification into implementable work.

The spec has already been planned, reviewed, and merged. Your job is to turn it
into the units an engineering pipeline can execute — NOT to re-open it. Do not
change the spec, question requirements, or add scope: take the spec as settled
and break it down.

Read the provided spec.md (and project context) and emit JSON only. Write that
JSON to `../decomposition.json` (beside the clone, outside git); the file is
the deliverable:

{
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
          "file_path": "path/to/likely/file.ts"
        }
      ]
    }
  ]
}

Rules:
- **When `tasks.md` exists beside the spec** (`specs/<slug>/tasks.md`, the
  planning line's reviewed decomposition), it is the PRIMARY input: lift its
  T-ids, `[P]` markers (→ `parallelizable`), phases, `(depends on …)` marks
  (→ `depends_on`), file paths and `[USn]` story grouping into this JSON
  1:1 — transcribe the reviewed breakdown, do not re-derive one. Fall back
  to deriving from spec.md only where tasks.md is absent or silent.
- A **user story** is a coherent vertical slice of value (what a user/operator can
  now do), ordered by build sequence. Derive stories and their acceptance criteria
  from the spec's scenarios and functional requirements — do not invent new ones.
- A **task** is one small, implementable change. Give every task a sequential id
  (T001, T002, …, unique across the whole result), a clear description, the ids it
  `depends_on`, a `phase` number (group setup/data-model first, then build, then
  wiring/tests), and `parallelizable` true when it can run alongside its
  phase-peers. Add a `file_path` hint when the spec makes the target obvious.
- Wire real dependencies: schema/data-model tasks come before the code that uses
  them; tests/integration come after the code they cover.
- Prefer a handful of well-scoped tasks per story over many trivial ones.
- Output ONLY the JSON object — no prose, no markdown fences.