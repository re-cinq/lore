# Tasks: Shared organisation skills

| Feature | Shared organisation skills     |
| ------- | ------------------------------ |
| Spec    | [spec.md](./spec.md)           |
| Plan    | [plan.md](./plan.md)           |
| Created | 2026-10-13                     |

Implementing this checklist delivers dynamic, database-backed organisation skills distributed via the local MCP server.

## Phase 1: Setup

- [ ] T001 Add `NNNN_skill_definitions.sql` migration (next free slot after `0110_utopia_memory_mirror.sql`) under `infra/terraform/modules/gke-mcp/lore-platform/charts/ui-helm/migrations/` for `lore.skill_definitions` (FR-001).
- [ ] T002 Add `libs/shared/src/domain/models/skill-definition.ts` domain model (Zod schema + `ColumnMap`/`fromRow`/`selectList`) (FR-005).

## Phase 2: Foundational

- [ ] T003 Add `project.skillDefs` resolution logic under `libs/shared/src/outbound/project/` (two-layer: project row → org row) (FR-009).
- [ ] T004 Add `/api/skill-definitions` CRUD route under `apps/lore-api/src/transport/routes/skill-definitions/` (GET read-scoped, POST/PUT/DELETE admin-scoped) (FR-006).
- [ ] T005 Seed the three static skills (`lore-context`, `tdd-loop`, `legacy-characterize`) from `apps/mcp-server/agent-skills/skills/` into `lore.skill_definitions` at lore-api boot, adding a `## Help` block to each first (FR-007, FR-010).

## Phase 3: Web UI

- [ ] T006 Add the Skills management page under `apps/web-ui/src/app/` (list/create/edit/delete, org-level only) modelled on `apps/web-ui/src/app/agents/` (FR-002, FR-003).
- [ ] T007 Validate or prompt for the `## Help` block in the Skills editor so a saved skill passes the `skill-help` CI check (FR-008; `specs/lore-help/spec.md` "The Help-block convention" section).

## Phase 4: Sync

- [ ] T008 Add `apps/mcp-server/src/transport/skills-sync.ts`: poll `/api/skill-definitions`, write/update/remove `~/.claude/skills/<name>/SKILL.md` with a `.lore-managed` ownership marker, gated on `serverMode !== 'agent'` (FR-004).
