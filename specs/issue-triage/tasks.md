# Tasks: Issue Triage Assembly Line

| Feature | Issue Triage Assembly Line             |
| ------- | -------------------------------------- |
| Spec    | [spec.md](./spec.md)                   |
| Plan    | [plan.md](./plan.md)                   |
| Created | 2026-09-28                             |

This checklist delivers the Issue Triage Assembly Line to automate bug reproduction, diagnosis, and verification.

## Story map

| Story | Spec scenario                                    | Priority |
| ----- | ------------------------------------------------ | -------- |
| US1   | Automated Bug Reproduction in Sandbox            | P1       |
| US2   | Root Cause Diagnosis and Spec Verification       | P1       |
| US3   | Obsolete Issue Detection and Automatic Closing   | P2       |
| US4   | Large Issue Detection and Decomposition          | P2       |
| US5   | Human-Gated Handoff to Implementation            | P1       |

**MVP**: completing Setup + Foundational phases + US1 delivers a working reproduction sandbox.

A 2026-10-06 audit of this spec against its plan found four requirements no task owned and five that described a machine which would not run; T003 is dropped, T008–T013 are rescoped onto FR17's per-verdict label nodes, and T015–T018 are new. The findings are #2542–#2550.

## Phase 1: Setup

- [x] T001 Add `libs/assembly-lines/src/floor-pipelines/issue-triage.yaml` holding its terminal `done` exit node, and add `"issue-triage"` to the pinned pipeline list in `apps/lore-api/src/work/floor/seed-floor-pipelines.test.ts`. — test: `apps/lore-api/src/work/floor/seed-floor-pipelines.test.ts` asserts the stub loads without error and `"issue-triage"` appears in the declared-lines list (#2532, #2535)

## Phase 2: Foundational *(blocks all stories)*

- [ ] T002 [P] Add agent recipe files `libs/shared/src/agent-defaults/triage-reproduce.md`, `triage-diagnose.md`, `triage-verify.md` and `triage-decompose.md` — each with frontmatter (`model`, `timeout_minutes`) and a body stating what the agent writes and which `LORE_NODE_RESULT` value it emits for each custom outcome; `triage-decompose` reads the issue body and the diagnosis and writes `feature-decompose`'s output JSON unchanged (FR6, FR12). — test: `apps/lore-api/src/work/floor/seed-floor-pipelines.test.ts` "give every agent definition a non-empty prompt" assertion passes once the YAML agent nodes are wired in T008–T013

- [ ] ~~T003 Add `"issue-triage"` to `TaskTypeSchema` and `TRUST_LEVELS`~~ — **dropped** (FR13, #2549). A triage run starts via `floor.lines.start` with no `pipeline.tasks` row, so neither value would ever be read, and the line writes labels, comments and child issues, never code.

- [ ] T004 [P] Implement the `triage_label` service station in `apps/stations/src/work/triage-label/` (one `index.ts` + `manifest.ts` following the `@re-cinq/floor-station` pattern) to apply the `triage:*` label its node names via `project.issues.addLabel` and optionally post a comment if one is defined in its params; register it in `apps/stations/src/index.ts` (FR23, FR19). One station serves every label node of FR17; the label comes from the node's own params, never from the predecessor's outcome. — test: `apps/stations/src/work/triage-label/triage-label.test.ts` asserts the station applies the label its params name and posts a comment when provided

- [ ] T005 [P] Implement the `close_issue` service station in `apps/stations/src/issue-triage/close-issue/` (one `index.ts` + `manifest.ts`) to post a verdict comment then call `project.issues.close`; register it in `apps/stations/src/index.ts` (FR15). — test: `apps/stations/src/issue-triage/close-issue/close-issue.test.ts` asserts the station posts the verdict comment before closing the issue

- [x] T006 Extend the `github.issues.labeled` handler in `apps/stations/src/events/repo-handlers.ts`: `lore:triage` and `triage: needs-triage` start an issue-triage floor run; `lore:implementation` on an issue whose run is parked at `human-gate` reports to that visit before the active-task guard and only then dispatches the implementation task (FR7, FR16). — test: `apps/stations/src/events/repo-handlers.test.ts` (#2532)

- [x] T007 Add the `cron.issue_triage.tick` emitter in `libs/shared/src/work/scheduler/cron-emitters.ts` and the `issue-triage-tick` sweep in `apps/stations/src/work/issue-triage-tick/` picking the oldest `triage: needs-triage` issues up to a per-repo concurrency cap (FR9). — test: `apps/stations/src/work/issue-triage-tick/issue-triage-tick.test.ts` (#2534)

- [ ] T015 [P] Create the eight `triage:*` labels in `libs/shared/src/work/onboard/enrol-repo.ts` beside Lore's existing labels, and backfill the repositories onboarded before this line existed (FR14, #2542). A label node fails on a label the repository does not have, so this blocks every story. — test: `libs/shared/src/work/onboard/enrol-repo.test.ts` asserts each of the eight labels is created for a freshly enrolled repository

- [ ] T016 Apply `triage: failed` from the `lore-run-settled` station when an issue-triage run reaches a terminal state with no node verdict — crashed or cancelled pod, timeout, floor-side error (FR18, #2543). Without it the issue keeps `triage: needs-triage` and T007's sweep restarts it every tick forever. (depends on T004, T015) — test: `apps/stations/src/code-review/run-settled/` test asserts a terminal issue-triage run with no verdict labels its issue `triage: failed`

- [ ] T017 Make the reporter loop real (FR19, FR26, #2544): the `label-needs-repro` and `label-unable` nodes post a comment naming what the reporter must supply, and the `github.issue_comment` handler in `apps/stations/src/events/repo-handlers.ts` re-applies `triage: needs-triage` when the reporter comments on an issue carrying `triage: needs-reproduction` or `triage: unable-to-reproduce`. (depends on T004, T015) — test: `apps/stations/src/events/repo-handlers.test.ts` asserts a reporter comment on a `needs-reproduction` issue re-applies `triage: needs-triage`, and a comment on an unlabelled issue does not

- [x] T018 Declare `issue_url` with `subject: true` in `libs/assembly-lines/src/floor-pipelines/issue-triage.yaml` so the floor refuses a second concurrent run for an issue one already holds (FR7, FR9, FR21, #2547). Today the webhook starts a run and the two-minute sweep starts another for the same issue. Landed with the pipeline lint that enforces it for every line (#2552). — test: `libs/assembly-lines/src/pipeline-lint.test.ts` reports `unkeyed-line` for a line no arg keys

## Phase 3: User Story 1 — Automated Bug Reproduction in Sandbox (P1, MVP)

**Independent test**: Triggering the triage line on an issue with a valid reproduction repository results in the bot successfully running the reproduction and applying the `triage: reproduced` label.

- [ ] T008 [US1] Define the `reproduce` agent node in `libs/assembly-lines/src/floor-pipelines/issue-triage.yaml` with agent definition `triage-reproduce`, `timeout_minutes: 15`, and custom outcomes `[unable-to-reproduce, needs-reproduction, skipped]`; give it one label node per outcome — `label-reproduced` → `diagnose`, and `label-needs-repro`, `label-unable`, `label-skipped` and `label-failed` each → `done` — with `iteration_max: 3` on the failure edge (FR11, FR17, FR25). (depends on T001, T002, T004, T006, T015) — test: `apps/lore-api/src/work/floor/seed-floor-pipelines.test.ts` asserts the YAML loads without schema errors, `reproduce` declares the expected custom outcomes, and each outcome reaches its own label node

- [ ] T009 [US2] Define the `diagnose` agent node with agent definition `triage-diagnose` and `timeout_minutes: 10`; success → `label-diagnosed` → `verify`, failure (with `iteration_max: 3`) → `label-failed` → `done` (FR25). (depends on T002, T008) — test: `apps/lore-api/src/work/floor/seed-floor-pipelines.test.ts` asserts all `diagnose` edges are covered

- [ ] T010 [US2] Define the `verify` agent node with agent definition `triage-verify`, `timeout_minutes: 10`, and custom outcomes `[obsolete, large-issue, not-actionable]`; success → `human-gate`, `obsolete` → `close-obsolete`, `large-issue` → `decompose`, `not-actionable` → `label-not-actionable` → `done`, failure (with `iteration_max: 3`) → `label-failed` → `done` (FR22, FR25). (depends on T002, T009) — test: `apps/lore-api/src/work/floor/seed-floor-pipelines.test.ts` asserts every `verify` outcome has a matching outgoing edge

## Phase 5: User Story 5 — Human-Gated Handoff to Implementation (P1)

- [x] T011 Add the `human-gate` node of `kind: human` with `route: '{args.issue_url}'` and its success edge to `done` (FR16). — test: `apps/lore-api/src/work/floor/seed-floor-pipelines.test.ts` (#2535)

## Phase 6: User Story 3 & 4 — Obsolete Issues and Decomposition (P2)

- [ ] T012 [US3] Add the `close-obsolete` node using the `close-issue` service station with an `always` edge to `done` (FR5, FR15). (depends on T005, T010) — test: `apps/lore-api/src/work/floor/seed-floor-pipelines.test.ts` asserts `close-obsolete` uses the `close-issue` station and its only outgoing edge is `always`

- [ ] T013 [US4] Add the `decompose` agent node using the new `triage-decompose` agent definition with an `always` edge to an `issues` station (which uses `file-issues`) that then routes to `done`; its output JSON is `feature-decompose`'s contract, so the existing issue-filing station consumes it unchanged (FR6, FR20, #2546). (depends on T002, T010, T012) — test: `apps/lore-api/src/work/floor/seed-floor-pipelines.test.ts` asserts `decompose` routes to `issues`, which has an `always` edge to `done`, and every edge of the complete graph is covered

## Phase 7: Polish

- [ ] T014 Update `specs/github-issue-dispatch/spec.md` to promote `lore:triage` and `triage: needs-triage` from a planned note to real dispatch-table entries in the 'What Changes' section, naming `apps/stations/src/events/repo-handlers.ts` as the implementation site. — test: verified by the handler test from T006 (`repo-handlers.test.ts` asserts `lore:triage` → issue-triage floor run)
