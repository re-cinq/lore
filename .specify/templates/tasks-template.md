<!-- Based on github/spec-kit v1.0.12 (e77daa9) templates/tasks-template.md,
     adapted to this repository's spec standard (.lore/spec-standard.md).
     Diff against upstream when adopting a newer spec-kit release. -->

# Tasks: [FEATURE NAME]

| Feature | [FEATURE NAME]         |
| ------- | ---------------------- |
| Spec    | [spec.md](./spec.md)   |
| Plan    | [plan.md](./plan.md)   |
| Created | [DATE]                 |

[One sentence: what implementing this checklist delivers.]

<!-- RULES FOR FILLING THIS TEMPLATE (delete this comment block when done):
  - Format: `- [ ] T001 [P] [US1] Description with the real file path as
    inline code`. IDs are sequential and unique across the whole file. [P]
    marks tasks that can run in parallel (different files, no dependency).
    [USn] names the spec.md user story a task belongs to; omit it for Setup
    and Foundational phases. State dependencies as `(depends on T00n)`.
  - These fields feed decomposition 1:1 (id, parallelizable, phase,
    depends_on, story) — the decompose step lifts them, it does not
    re-derive them.
  - Group tasks by user story so each story ships independently: Setup →
    Foundational → one phase per story (P1 first = MVP) → Polish.
  - Write real file paths as inline code, never markdown links
    (no-dead-md-links errors on links to files that do not exist yet).
  - Keep a trailing newline. -->

## Story map

| Story | Spec scenario                 | Priority |
| ----- | ----------------------------- | -------- |
| US1   | [User Story 1 — title]        | P1       |
| US2   | [User Story 2 — title]        | P2       |

**MVP**: completing Setup + Foundational + the US1 phase delivers a working
[what].

## Phase 1: Setup

- [ ] T001 [description with real path, e.g. add `libs/…/file.ts`]

## Phase 2: Foundational *(blocks all stories)*

- [ ] T002 [P] [description]
- [ ] T003 [description] (depends on T002)

## Phase 3: User Story 1 — [title] (P1, MVP)

**Independent test**: [how US1 is verified on its own]

- [ ] T004 [P] [US1] [description]
- [ ] T005 [US1] [description] (depends on T004)

## Phase 4: User Story 2 — [title] (P2)

**Independent test**: [...]

- [ ] T006 [P] [US2] [description]

## Phase N: Polish

- [ ] T007 [docs, cleanups, follow-ups]
