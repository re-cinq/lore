# Feature Specification: Agents as data (lore.agents)

| Field    | Value                          |
|----------|--------------------------------|
| Feature  | Agents as data                 |
| Branch   | feat/lore-agents-table         |
| Status   | In review                      |
| Created  | 2026-06-16                     |
| Owner    | Platform Engineering           |
| ADR      | ADR-026                        |

## Why

Per-task-type behaviour (model, timeout, prompt, container image) was hardcoded
in `scripts/task-types.yaml` and only thinly overridable per repo via a JSONB
blob. Operators could not define or retune a repo's agents without a source edit
and redeploy. This promotes agents to first-class, per-repo data — a real
`lore.agents` table, a dedicated **Agents** settings tab, and a `/lore-agents`
skill — reached only through the `project.agents` port. See ADR-026.

## Scope (Phase 1)

In: the `lore.agents` table; resolution (project → org → yaml) via
`project.agents`; the agents HTTP API; per-repo Agents tab (CRUD); the
`/lore-agents` skill; floor + runner resolution through the port.

Out (Phase 2, follow-up): the `.lore/workflows/` loader (repo > built-in) and the
workflow `on:` triggers + event-dispatch registry. The agent carries neither a
`workflow` nor a `trigger` column.

## Data model

`lore.agents(id, name, model, timeout_minutes, prompt, image, project_id,
execution_mode, review_required, created_at, updated_at)`. `project_id = NULL` is
the organisation default; a `project_id` (→ `lore.repos.id`) is a repo override.
Partial unique indexes: one org default per `name`; one override per
`(name, project_id)`. Migration `0015` seeds org rows from the `task-types.yaml`
scalars (prompt inherits the yaml) and migrates existing
`settings.task_overrides` into project rows.

## Requirements

- **FR1 — Port access.** All agent reads/writes go through `project.agents`
  (`resolve` / `list` / `create` / `update` / `delete`); no consumer touches
  `lore.agents` directly. ([validated by resolves a definition bound to the facade's repo](../../libs/shared/src/project/agents/agents.test.ts#L65))
- **FR2 — Precedence.** Resolution field-merges project → org → yaml; a null
  nullable field inherits the next layer. ([validated by lets a project row's set fields beat the org row](../../libs/shared/src/project/agents/agent-defs-port.test.ts#L42))
- **FR3 — Three adapters.** DB → `PgAgentDefs`; Station/local → `AgentDefsHttp`
  (the runner fetches over the API); offline → `AgentDefsYaml`. ([validated by resolves an agent by fetching the API with the bearer token](../../libs/shared/src/project/agents/agent-defs-http.test.ts#L52)) ([validated by resolves a task type into an org-level definition](../../libs/shared/src/project/agents/agent-defs-yaml.test.ts#L52))
- **FR4 — Yaml prompt inheritance.** A seeded org row leaving `prompt` null
  inherits the yaml prompt. ([validated by resolves the org row and inherits the prompt from the yaml base](../../libs/shared/src/project/agents/agent-defs-pg.test.ts#L59))
- **FR5 — Authorization.** Agent writes are admin-scoped; `GET` is read-scoped;
  the `image` field is two-key gated. ([validated by returns admin for agent writes](../../apps/mcp-server/src/api/routes/auth.test.ts#L42)) ([validated by flags a write that sets a non-empty image](../../apps/mcp-server/src/features/agents/agents-schema.test.ts#L36))
- **FR6 — UI.** The Agents tab lists resolved agents as editable cards
  (model dropdown + custom, timeout, prompt, gated image) with add/edit/delete.
  ([validated by renders an agent card per resolved agent, prefilled, in the Agents tab](../../apps/web-ui/src/app/repos/[owner]/[repo]/settings/SettingsView.test.tsx#L72))

## Acceptance

A repo's `general` agent edited in the Agents tab (model + prompt) writes a
project row; `GET /api/repos/:o/:r/agents/general` returns the resolved override;
a `general` task resolves the overridden model/prompt; a repo with no override
gets the org default; an image change without an approval PR is refused.
