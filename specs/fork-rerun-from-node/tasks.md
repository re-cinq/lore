# Tasks: Fork-and-Rerun of Assembly Lines from a Completed Node

| Field  | Value                       |
|--------|-----------------------------|
| Branch | `feat/fork-rerun-from-node` |
| Status | In Progress                 |

Every task is test-first: write the failing test, confirm it fails for the
stated reason, then implement. One commit per task; the spec's
`([validated by …])` links land in the same commit as the tests they name.

## Phase 1 — Specification

- [x] T001 Write `specs/fork-rerun-from-node/spec.md` and this file; supersede `adrs/ADR-041-fork-rerun-from-node.md`.

## Phase 2 — Substrate (independent, parallelizable)

- [x] T002 [P] FR4 hash — `libs/assembly-lines/src/definition-hash.ts` + `definition-hash.test.ts`, exported from `libs/assembly-lines/src/index.ts`. Tests first: stable across key ordering, changes with any node/edge edit, 64-hex output.
- [x] T003 [P] FR4/FR5 schema — `infra/terraform/modules/gke-mcp/lore-platform/charts/ui-helm/migrations/0036_assembly_line_fork_columns.sql` adding `definition_hash`, `resumed_from_line_id`, `resumed_from_node_id` to `pipeline.assembly_lines`. Idempotent (`ADD COLUMN IF NOT EXISTS`). Schema evidence, no unit test.
- [x] T004 [P] FR2 cutoff + validation — `libs/shared/src/project/assembly-lines/resume.ts` + `resume.test.ts`: `resumeCutoffIndex()` and `resolveResumePrefix()`, the pure rules both adapters share. Tests first, one per rejection reason. Carries the `assembly-lines-port.ts` surface those rules read (`resumeFrom`, `definitionHash`, `resumedFrom*`) plus the adapter changes that surface type-forces, since a port widening and its implementations cannot land apart.

## Phase 3 — The start API

- [ ] T005 FR4 stamping — `stampDefinitionHash` in both adapters, write-once. Tests appended to `libs/shared/src/project/assembly-lines/assembly-lines.test.ts`.
- [ ] T006 FR1/FR2/FR3 in the double — `InMemoryAssemblyLines.start` with `resumeFrom`, the behavioural spec. Tests appended to the same file.
- [ ] T007 FR1/FR2/FR3 in Postgres — `PgAssemblyLines.start` resume branch as one data-modifying CTE, plus the facade pass-through. Tests appended to the same file.

## Phase 4 — Floor integration

- [ ] T008 FR4 stamping — `apps/floor/src/jobs/assembly-line/start-event-handler.ts` stamps `definitionHash(definition)` when the definition resolves. Tests appended to `start-event-handler.test.ts`.
- [ ] T009 FR5 walk — `apps/floor/src/jobs/assembly-line/advance.ts` counts the inherited prefix in the branch-overlap guard, and a forked line advances to the cutoff node's successor. Tests appended to `advance.test.ts`.

## Phase 5 — Close out

- [ ] T010 Delete `adrs/ADR-041-fork-rerun-from-node.md`; flip the spec's `| Status |` row to the tier its coverage entitles it to.
