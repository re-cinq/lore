---
timeout_minutes: 15
review_required: false
model: claude-sonnet-4-6
# The approved plan arrives as a downloaded file rather than in the prompt, so a
# plan of any size fits (ADR-047).
inputs:
  - path: plan.md
    source: plan
# The writer's answer to a spec review crosses back as an artifact the Floor
# owns (never merged into args): the questions it sends to the plan and the
# reply it owes each review comment. Always written, empty when no review ran.
watch:
  event: spec.review.result
  path: target/spec-review-result.json
---
Turn an approved plan into committable specifications. The plan was written
and approved by its people; do not re-open it. It is in
`$WORKSPACE_DIR/plan.md` (`../plan.md` from your working directory).

{description}

## What the analysis decided

The step before you read this repository's specs and decided which files and
which statements this plan changes. It is rendered below. Edit THOSE places:
when it names a statement, amend that statement rather than adding a rival
beside it; when it names a file to create, create it where it says; a file it
lists as left alone is out of bounds.

{spec_plan}

## How a plan becomes spec

- A statement the plan contradicts is amended in place, keeping the fact it
  carried and stating the consequence. Never leave the old rule standing
  beside the new one, and never drop a "because" the old rule gave.
- Every requirement in a spec the plan touches must still be true once the
  plan is done — a placeholder rule, a "blocked on" row, a problem statement
  that argued for the old design: amend or retire each one the plan overtakes.
- The plan's KPIs become measurable outcomes in the spec's own form
  (`SC-nnn` statements, or whatever this repository's standard uses), never
  the plan's ```` ```kpi ```` fences.
- The plan's Constraints become compliance requirements where the spec keeps
  them; its Delivery implications and hard dependencies on other issues land
  in the Issue Map or the Blocked row.
- An Open question in the plan stays open, in the spec's own Open Questions,
  with the choices it names. Never answer it for the author.
- Every requirement you add carries the issue tag its neighbours carry, and a
  Danish user-facing sentence goes where this repository reviews such
  sentences.

Write the specs it calls for (following this repo's spec conventions and the
metadata-table format). Do not implement code.

## When the spec review sent this back

When the plan's spec PR is under review, this pass runs again with the review
appended at the end of this prompt under "The spec review said": every open
inline comment and every review body, each with an id. The specs are on THIS
branch already; amend them, do not rewrite them. For each item decide:

- It stays inside what the plan settled: amend the spec accordingly and
  record `{"comment_id": <id>, "action": "addressed", "note": "<what you changed>"}`.
- It contradicts what the plan settled, or decides something the plan left
  open or never spoke of: change NOTHING for it. Record
  `{"comment_id": <id>, "action": "to_plan"}` and add a plan question
  `{"slot": "<section slot>", "question": "<the decision, as a question>", "why": "<the comment, quoted, and where it collides with the plan>", "comment_id": <the comment's id>}`.
  The `comment_id` is what keeps the question one question: a later pass
  that rewords it replaces it in the plan instead of asking twice.
  The slot is the plan.md section marker the matter belongs to (`intent`,
  `scope`, `constraints`, a `custom-…` slot, …). Never answer for the plan's
  people: the plan stays as it is until they do.
- A review body with no single comment id is answered the same way, by the
  review's id.

Always write `spec-review-result.json` in the working directory (the
repository root), on every pass of this recipe:

    {"plan_questions": [ {"slot": "...", "question": "...", "why": "...", "comment_id": 0} ],
     "replies": [ {"comment_id": 0, "action": "addressed" | "to_plan", "note": "..."} ]}

A pass with no review writes `{"plan_questions": [], "replies": []}`. Commit
the specs, never this file.

DELIVERY, NON-NEGOTIABLE — the next step runs in a DIFFERENT container:
- Before you commit, run the repository's FORMATTER over the files you
  changed (`npx prettier --write <files>`, `gofmt -w <files>`, whichever
  this repo uses) and nothing else from CI's checklist. Do NOT run the
  linter in this pod: CI runs it on every push, and here it does not
  fit — in this repository a two-file `eslint` peaks near 800 MB against
  a 1Gi pod. A lint finding comes back as a red build naming the file
  and line.
- Do NOT typecheck here either, and NEVER run a workspace build in this
  pod (`npm run build`, `tsc -b`, a `tsc` without `--noEmit`): CI's build
  step proves compilation, and the build is the 950 MB step that
  OOM-kills a 1Gi pod.
- When the work is done, `git add` what you changed and commit it with a
  short, factual message. Then `git push origin HEAD`. The clone carries
  its own credentials, so a plain push authenticates; you need no token
  and must never look for one.
- Then bring the branch up to date with its base — `git fetch origin main`
  and merge `origin/main` in — and push again if that produced anything.
  A branch that cannot merge cleanly gets NO CI AT ALL: GitHub runs no
  workflow on a conflicted pull request. Resolve any conflict now,
  favouring `origin/main` for anything this pass did not write, and never
  by discarding your own work.
- Confirm it landed: `git status` must report the branch is not ahead of
  its upstream. An unpushed commit lives only in this container and
  dies with it — do NOT report success for one. Plan b5ec0e24's specs
  were committed here and never pushed: the push step found an empty
  branch and no spec PR could be opened.
- If you genuinely changed nothing on a FIRST pass, say why and end your
  final message with the line `LORE_NODE_RESULT: {"outcome":"failed"}` so
  the line does not validate an empty branch. A review pass is different:
  when every item was already addressed on this branch or went to the plan,
  the specs are right as they stand — `spec-review-result.json` is your
  delivery, so end with `LORE_NODE_RESULT: {"outcome":"success"}` and no
  commit; the push step finds nothing to deliver and says so.
- Do not open a pull request: you have no `gh` and no GitHub token. Lore
  opens the PR from the branch you pushed.
