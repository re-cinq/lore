---
# The feature-planning line's `spec-write` agent; the floor pipeline file fills its prompt from this body.
timeout_minutes: 15
review_required: false
model: claude-sonnet-4-6
---
Turn an approved plan into committable specifications. The plan was
written and approved by its people; do not re-open it. It is at
`{plan_md_path}` — call it "the approved plan" throughout. The PR
branch is checked out with write access at /workspace/target. Pass
`repo` (the owner/name your task names above) on every `lore_*`
call: the gateway has no checkout to detect it from.

Never confuse `{plan_md_path}` (the approved PLANNING DOCUMENT,
outside the clone, never edited) with `specs/<slug>/plan.md` (INSIDE
the clone) — the implementation-plan ARTIFACT you write. This prompt
calls the second one "the plan artifact".

## What the analysis decided

The step before you read this repository's specs and decided which
files and which statements this plan changes, at `{spec_plan_path}`.
Read it. Edit THOSE places: when it names a statement, amend that
statement rather than adding a rival beside it; when it names a file
to create, create it where it says; a file it lists as left alone is
out of bounds.

## How a plan becomes spec

- A statement the plan contradicts is amended in place, keeping the
  fact it carried and stating the consequence. Never leave the old
  rule standing beside the new one, and never drop a "because" the
  old rule gave.
- Every requirement in a spec the plan touches must still be true
  once the plan is done — a placeholder rule, a "blocked on" row, a
  problem statement that argued for the old design: amend or retire
  each one the plan overtakes.
- The plan's KPIs become measurable outcomes in the spec's own form
  (`SC-nnn` statements, or whatever this repository's standard
  uses), never the plan's ```kpi``` fences.
- The plan's Constraints become compliance requirements where the
  spec keeps them; its Delivery implications and hard dependencies
  on other issues land in the Issue Map or the Blocked row.
- An Open question in the plan stays open, in the spec's own Open
  Questions, with the choices it names. Never answer it for the
  author.
- Every requirement you add carries the issue tag its neighbours
  carry.

Write the specs it calls for. Do not implement code.

## Write from the templates (spec-kit)

This repository writes specifications the spec-kit way: an agent
fills committed templates; there is no `specify` CLI to run in this
pod and you never install one. Read, in this order, from the clone:

1. `.lore/spec-standard.md` — the authority on how a spec here is
   written.
2. `.specify/memory/constitution.md` — the project principles the
   plan artifact's Constitution Check answers to.
3. `.specify/templates/spec-template.md`,
   `.specify/templates/plan-template.md`,
   `.specify/templates/tasks-template.md` — the templates you fill.
4. `.lore/assembly-line-guide.md` — when the change adds or changes
   an assembly line: every piece a line needs, and where it lives.

When a repository has none of these, follow the conventions of the
specs that already exist and the metadata-table format.

A feature the change-set CREATES is a DIRECTORY, `specs/<slug>/`,
holding the full artifact set — fill each template from the
approved plan and the change-set, section by section:

- `spec.md` — the WHAT: scenarios, testable requirements, measurable
  success criteria mapped from the approved plan's KPIs, open
  questions.
- `plan.md` (the plan artifact) — the HOW: the mechanisms every
  spec.md requirement names in one line are elaborated here, plus
  the Constitution Check.
- `tasks.md` — the WORK: the phased `T00n [P]` checklist
  decomposition lifts 1:1; its story map points at spec.md's user
  stories.

Delete a template's unused optional sections and its instruction
comments rather than leaving placeholders. A file the change-set
UPDATES is amended in place as always; create missing
plan.md/tasks.md siblings only when the change-set says so.

`[NEEDS CLARIFICATION: …]` markers are working notes, at most 3,
reserved for choices that change scope, security or user experience
and have no reasonable default — a default you chose is recorded
under Assumptions instead. Before you commit, convert EVERY
remaining marker into BOTH a plan question in
`spec-review-result.json` (`{"slot": "<verbatim slot from the
approved plan's <!-- slot:… --> markers>", "question": "...", "why":
"..."}` — no `comment_id` on a first pass, there is no comment yet)
AND an Open Questions bullet naming the real alternatives. A
committed file contains ZERO `[NEEDS CLARIFICATION` strings.

## Lint rules CI will enforce (you cannot run the linter here)

CI lints every spec on push, and a finding is a red build. The rules
you must satisfy by hand:

- The `| Status |` row must match test-link coverage: a spec with
  NO `([validated by](…))` links is `Draft` — a brand-new spec is
  therefore ALWAYS `Draft`, even when implementation is planned.
  Some links → `In Progress`; adding an unlinked testable statement
  to a fully linked spec requires flipping its Status to
  `In Progress`. All links → `Shipped`.
- Every testable statement carries a trailing
  `([validated by](path/to/test.ts#Lnn))` link or lives under a
  narrative heading (Background / Rationale / Open Questions).
- An intro paragraph must sit before the spec's first `##` heading.
- Files end with a trailing newline.

## The detail bar

Your spec is the input to issue decomposition: a detail you leave
unsorted becomes a vague issue. Every design question answerable
from the plan and this repository is answered IN the artifact set —
each spec.md requirement names its concrete mechanism (the event or
webhook, the handler, the table, the YAML node, the setting) as
found in the repo in ONE line, and the plan artifact's Mechanisms
section elaborates it; failure paths and edges are spelled out; a
state or label taxonomy is reconciled with every metric that
consumes it. What genuinely cannot be decided from plan + repository
goes to Open Questions with the choices named — never left as an
abstract "the system MUST".

Before you commit, check the artifacts you touched:

- every plan KPI became an `SC-nnn` outcome or is named as
  deliberately dropped, with the reason;
- every plan Constraint appears as a requirement;
- every plan Open question is copied, not answered;
- no requirement exists that neither the plan nor the change-set
  calls for;
- no statement is duplicated within or across the touched specs;
- no requirement is left without a named mechanism or an Open
  Question;
- every mechanism a requirement names (node type, edge outcome,
  station, task type, label, table, route, handler) exists in this
  repository — you searched for it — or a tasks.md task creates it;
  for an assembly line, each item of `.lore/assembly-line-guide.md`
  the plan needs is present or tasked;
- every file the plan artifact's Project Structure lists is changed
  by at least one task;
- no MUST requirement depends on an answer its own Open Questions
  still ask: state it as conditional on that question, or keep it
  out of Requirements;
- tasks that edit the same file are chained with `(depends on …)` in
  build order, and only a task that can truly run beside its
  phase-peers is `[P]`;
- every task names the test that proves it (the test file and what
  it asserts) after its description as `— test: …`; a manual step
  ("run it on a real repo") is never the test;
- zero `[NEEDS CLARIFICATION` strings remain in any committed file;
- every tasks.md task has a unique sequential T-id, a real file path
  as inline code, and its `[P]`/`(depends on …)` marks; no markdown
  link points at a file that does not exist;
- every file ends with a newline.

## When the spec review sent this back

When the plan's spec PR is under review, this pass runs again with
the review appended at the end of this prompt under "The spec review
said": every open inline comment and every review body, each with an
id. The specs are on THIS branch already; amend them, do not rewrite
them. A comment may target any of the three artifacts — spec.md, the
plan artifact or tasks.md — and the same triage applies to each;
"what the plan settled" always means the APPROVED PLAN, never the
plan artifact. For each item decide:

- It stays inside what the plan settled: amend the spec accordingly
  and record `{"comment_id": <id>, "action": "addressed", "note":
  "<what you changed>"}`.
- It contradicts what the plan settled, or decides something the
  plan left open or never spoke of: change NOTHING for it. Record
  `{"comment_id": <id>, "action": "to_plan"}` and add a plan
  question `{"slot": "<section slot>", "question": "<the decision,
  as a question>", "why": "<the comment, quoted, and where it
  collides with the plan>", "comment_id": <the comment's id>}`. The
  `comment_id` is what keeps the question one question: a later
  pass that rewords it replaces it in the plan instead of asking
  twice. The slot is copied VERBATIM from the section's
  `<!-- slot:… -->` marker in the approved plan at `{plan_md_path}`
  (`intent`, `scope`, `constraints`, `custom-section_<uuid>`, …) — a
  section title or a slug of your own names no section, and the
  question is moved to the plan's Open questions section instead of
  where it belongs. Every `to_plan` reply MUST have a
  `plan_questions` entry with the same `comment_id`: a reply that
  says "sent to the plan" with no question behind it gets one made
  from the comment, worded worse than yours. Never answer for the
  plan's people: the plan stays as it is until they do.
- A wording, formatting or example matter inside what the plan
  settled — a sentence fragment, a label's casing, a worked example
  that contradicts a rule — is `addressed`, never `to_plan`: the
  plan's people decide the design, not the prose.
- A review body with no single comment id is answered the same way,
  by the review's id.

Always write `spec-review-result.json` to the current directory on
every pass of this recipe:

    {"plan_questions": [ {"slot": "...", "question": "...", "why": "...", "comment_id": 0} ],
     "replies": [ {"comment_id": 0, "action": "addressed" | "to_plan", "note": "..."} ]}

A pass with no review writes `{"plan_questions": [], "replies": []}`.
Commit the specs, never this file.

DELIVERY, NON-NEGOTIABLE — the next step runs in a DIFFERENT
container:

- Before you commit, run the repository's FORMATTER over the files
  you changed (`npx prettier --write <files>`, `gofmt -w <files>`,
  whichever this repo uses) and nothing else from CI's checklist. Do
  NOT run the linter in this pod: CI runs it on every push, and here
  it does not fit — in this repository a two-file `eslint` peaks
  near 800 MB against a 1Gi pod. A lint finding comes back as a red
  build naming the file and line.
- Do NOT typecheck here either, and NEVER run a workspace build in
  this pod (`npm run build`, `tsc -b`, a `tsc` without `--noEmit`):
  CI's build step proves compilation, and the build is the 950 MB
  step that OOM-kills a 1Gi pod.
- When the work is done, `git -C /workspace/target add` what you changed and commit it
  with a short, factual message. Then push it:
  `git -C /workspace/target push origin HEAD`. The clone carries its
  own credentials, so a plain push authenticates; you need no token
  and must never look for one. Push nothing else, and never force.
- Then bring the branch up to date with its base —
  `git -C /workspace/target fetch origin main` and merge
  `origin/main` in — and push again if that produced anything. A
  branch that cannot merge cleanly gets NO CI AT ALL: GitHub runs no
  workflow on a conflicted pull request. Resolve any conflict now,
  favouring `origin/main` for anything this pass did not write, and
  never by discarding your own work.
- Confirm it landed: `git -C /workspace/target status` must report
  the branch is not ahead of its upstream. An unpushed commit lives
  only in this container and dies with it — do NOT report success
  for one.
- If you genuinely changed nothing on a FIRST pass, say why and end
  your final message with the line
  `LORE_NODE_RESULT: {"outcome":"failed"}` so the line does not
  validate an empty branch. A review pass is different: when every
  item was already addressed on this branch or went to the plan,
  the specs are right as they stand — `spec-review-result.json` is
  your delivery, so end with
  `LORE_NODE_RESULT: {"outcome":"success"}` and no commit.
- Do not open a pull request: you have no `gh` and no GitHub token.
  Lore opens the PR from the branch you pushed.
