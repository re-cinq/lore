# How a spec is written in this repository

This file is the authority on spec conventions for `specs/**/spec.md`. The
spec-analysis and spec-write agents read it before touching a spec; humans hold
their own spec PRs to the same bar. Most of these rules are enforced by CI as
eslint errors (`@re-cinq/eslint-plugin-re-lint`), which agent pods cannot run —
so they are spelled out here.

## Shape

- Every spec starts with a metadata table with `Feature`, `Status`, `Created`
  and `Owner` rows, then an intro paragraph BEFORE the first `##` heading
  (`re-lint/require-intro-paragraph`, error).
- Files end with a trailing newline. Run the formatter (`npx prettier --write`)
  over changed files before committing; never run eslint, typecheck or a build
  in an agent pod.

## Status is derived from test-link coverage, not from progress

`re-lint/require-status-matches-coverage` (error) ties the `| Status |` row to
how many testable statements carry a `([validated by](path/to/test.ts#Lnn))`
link:

- **No links → `Draft`.** A brand-new spec has no tests yet, so it is ALWAYS
  `Draft`, even when implementation is planned or underway.
- **Some links → `In Progress`.** Adding an unlinked testable statement to a
  fully linked spec REQUIRES flipping its Status to `In Progress`.
- **All links → `Shipped`**.
- `Rejected` / `Retired` mark abandoned designs and are exempt.

## Statements

- Every testable statement either carries a trailing `([validated by](…#Lnn))`
  link — on the statement's own line, at its end — to
  the test that validates it, or lives under a narrative heading (Background /
  Rationale / Problem Statement / Open Questions), which is exempt
  (`re-lint/require-statement-links`).
- One rule lives in one place. Amend the statement that owns a fact instead of
  restating it elsewhere — in the same spec or another one. Two copies of a
  rule always drift.
- Anchor requirements to real machinery: name the event, webhook, handler,
  table, module, YAML node or setting a requirement rides on, the way existing
  specs in `specs/` do. "The system MUST detect duplicates" is not a
  requirement until it says where and with what.

## Fidelity to the approved plan

A spec written from a plan carries the whole plan and nothing beyond it:

- The plan's KPIs become measurable outcomes in the spec's own form (`SC-nnn`
  statements) — every KPI is mapped or explicitly named as dropped, with the
  reason. A KPI that measures a state or label must find that state defined in
  the spec; reconcile the taxonomy, never leave a metric pointing at a state
  that does not exist.
- The plan's Constraints become compliance requirements the spec keeps.
- The plan's Open questions stay open, verbatim, in the spec's own Open
  Questions section with the choices they name. Never answer one for the
  author.
- No requirement appears that neither the plan nor the analysis change-set
  calls for.
- Every statement that specifies a block of the plan cites it in its one
  trailing link group, beside any test links:
  `([from plan](<plan page>#<block id>), [validated by …](path/to/test.ts#L42))`.
  The planning line counts the blocks no statement cites and sends the writer
  back with them, then lists what is still uncited in the spec PR's body.

## The three-artifact feature directory (spec-kit)

A feature written by the planning line lives in `specs/<slug>/` as the
spec-kit artifact set, filled from the authoritative templates at
`.specify/templates/` (spec-template.md, plan-template.md,
tasks-template.md; header comments record the upstream spec-kit release they
adapt):

- **spec.md** — the WHAT: user scenarios, testable statements, `SC-nnn`
  success criteria, open questions. The lint rules above govern this file.
- **plan.md** — the HOW: the Mechanisms sections, Constitution Check against
  `.specify/memory/constitution.md`, failure edges, project structure. The
  statement-link and status rules do NOT govern it, but
  `re-lint/no-dead-md-links` does: only link files that exist; code file
  paths are inline code, never links.
- **tasks.md** — the WORK: the phased `- [ ] T00n [P]` checklist with real
  file paths and `(depends on T00n)` marks; decomposition lifts it 1:1 into
  issues instead of re-deriving a breakdown.

Spec-kit's `[NEEDS CLARIFICATION: …]` markers are working notes only — at
most 3, for choices with no reasonable default; each is converted to a plan
question plus an Open Questions bullet before commit, and zero survive in a
committed file.

## Detail before decomposition

The artifact set is the input to issue decomposition: a detail left unsorted
here becomes a vague issue. Every design question answerable from the plan
and the codebase is answered IN the artifacts — trigger wiring (which event
or webhook, which handler), the data model (tables, subject/overlap keys, new
settings and their defaults), the assembly line graph with its failure edges
and iteration caps, node types (agent vs detect vs service vs label-webhook
choreography), gating (trust-ladder level, per-repo opt-in setting), and the
exact state or label taxonomy reconciled with the metrics that consume it.
Every spec.md requirement names its mechanism in one line; the elaboration
lives in the feature's plan.md. A requirement that cannot name its mechanism
is either given one or moved to Open Questions — never left abstract.
