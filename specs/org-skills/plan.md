# Implementation Plan: Shared organisation skills

| Feature | Shared organisation skills  |
| ------- | --------------------------- |
| Branch  | org-skills                  |
| Spec    | [spec.md](./spec.md)        |
| Created | 2026-10-13                  |

This feature introduces a dynamic, database-backed system for managing organisation skills via the Lore web UI. These skills are automatically distributed and updated on local developers' machines by the local MCP server, replacing the static files in the repository.

## Technical Context

| Aspect           | Value                                                                      |
| ---------------- | --------------------------------------------------------------------------- |
| Language/Runtime | TypeScript ESM / Node 22                                                   |
| Modules touched  | `libs/shared`, `apps/lore-api`, `apps/web-ui`, `apps/mcp-server`           |
| Storage          | new `lore.skill_definitions` table (migration, next free slot)            |
| Testing          | vitest via workspace-source aliases                                        |
| Constraints      | `apps/mcp-server` stdio/local-only process, no DB access (ADR-032)         |

## Mechanisms

### Data model

- `lore.skill_definitions` table (FR-001): `name`, `title`, `description`, `model`, `content`, `enabled`, `project_id`.
- `libs/shared/src/domain/models/skill-definition.ts` (FR-005): Zod schema + `ColumnMap`/`fromRow`/`selectList`, mirroring `libs/shared/src/domain/models/agent-definition.ts`.
- `project.skillDefs` (FR-009) under `libs/shared/src/outbound/project/`: two-layer resolution (`project` row → org row), mirroring `project.agentDefs` in `libs/shared/src/outbound/project/agents/`.

### Trigger wiring

- `apps/lore-api/src/transport/routes/skill-definitions/` (FR-006): CRUD REST API, GET read-scoped, POST/PUT/DELETE admin-scoped, mirroring `apps/lore-api/src/transport/routes/agent-definitions/`.
- lore-api boot seeds the three static skills (FR-007) from `apps/mcp-server/agent-skills/skills/`, mirroring `libs/shared/src/outbound/project/agents/agent-defaults-seed.ts`.
- `apps/mcp-server/src/transport/skills-sync.ts` (FR-004): polling loop, gated on `serverMode !== 'agent'`, installs/updates/removes `~/.claude/skills/<name>/SKILL.md` behind a `.lore-managed` marker.
- `apps/web-ui/src/app/skills/` (FR-002/FR-003/FR-008): Skills management page mirroring `apps/web-ui/src/app/agents/`, validates the `## Help` block on save (FR-010).

## Project Structure

```text
specs/org-skills/
├── spec.md    # WHAT — reviewed statements + success criteria
├── plan.md    # this file
└── tasks.md   # WORK — feeds decomposition
```
