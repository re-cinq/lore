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

## Scope

In (this PR): the `lore.agents` table; resolution (project → org → yaml) via
`project.agents`; the agents HTTP API; per-repo Agents tab (CRUD); the
`/lore-agents` skill; floor + runner resolution through the port.

Out (Phase 2): the `.lore/workflows/` loader (repo > built-in) and the workflow
`on:` triggers + event-dispatch registry. The agent carries neither a `workflow`
nor a `trigger` column — both belong on the workflow.

## Data model

`lore.agents(id, name, model, timeout_minutes, prompt, image, project_id,
execution_mode, review_required, created_at, updated_at)`. `project_id = NULL` is
the organisation default; a `project_id` (→ `lore.repos.id`) is a repo override.
Partial unique indexes: one org default per `name`; one override per
`(name, project_id)`.

## Requirements

- **FR1 — Port-only access.** Agent config is reached only through
  `project.agents` (`resolve`/`list`/`create`/`update`/`delete`); no consumer
  reads `lore.agents` directly. ([validated by resolves a definition bound to the facade's repo](../../libs/shared/src/project/agents/agents.test.ts#L59))
- **FR2 — Precedence.** Resolution field-merges project → org → yaml; a null
  nullable field on a layer inherits the next layer down. ([validated by lets a project row's set fields beat the org row](../../libs/shared/src/project/agents/agent-defs-port.test.ts#L37))
- **FR3 — DB adapter merge.** `PgAgentDefs` field-merges the repo's project row
  over the org row over the yaml base. ([validated by merges a project row over the org default and yaml base](../../libs/shared/src/project/agents/agent-defs-pg.test.ts#L71))
- **FR4 — Yaml prompt inheritance.** A seeded org row that leaves `prompt` null
  inherits the prompt from the yaml base. ([validated by resolves the org row and inherits the prompt from the yaml base](../../libs/shared/src/project/agents/agent-defs-pg.test.ts#L60))
- **FR5 — Offline fallback.** `AgentDefsYaml` resolves task types from
  `task-types.yaml` and refuses writes (read-only without a DB). ([validated by resolves a task type into an org-level definition](../../libs/shared/src/project/agents/agent-defs-yaml.test.ts#L41)) ([validated by refuses writes without a database](../../libs/shared/src/project/agents/agent-defs-yaml.test.ts#L79))
- **FR6 — Runner fetches over the API.** `AgentDefsHttp` resolves an agent by
  fetching the agents endpoint with the bearer token and is read-only. ([validated by resolves an agent by fetching the API with the bearer token](../../libs/shared/src/project/agents/agent-defs-http.test.ts#L48)) ([validated by refuses writes from a runner](../../libs/shared/src/project/agents/agent-defs-http.test.ts#L65))
- **FR7 — Facade delegation.** `project.agents` delegates the definition methods
  to the wired port, bound to the facade's repo. ([validated by delegates create/delete to the defs port with the bound repo](../../libs/shared/src/project/agents/agents.test.ts#L75))
- **FR8 — Request validation + image gate.** The schema normalizes the body and
  flags a write that sets a non-empty `image` (two-key field). ([validated by flags a write that sets a non-empty image](../../apps/mcp-server/src/features/agents/agents-schema.test.ts#L37)) ([validated by rejects a non-kebab-case name](../../apps/mcp-server/src/features/agents/agents-schema.test.ts#L19))
- **FR9 — Authorization scope.** GET (resolve/list) is read-scoped; agent writes
  are admin-scoped. ([validated by returns read for a GET on the agents route (runner resolve)](../../apps/mcp-server/src/api/routes/auth.test.ts#L33)) ([validated by returns admin for agent writes](../../apps/mcp-server/src/api/routes/auth.test.ts#L38))
- **FR10 — API delegates + audits + two-key.** The route delegates CRUD to
  `project.agents`, audits writes, and two-key gates an image change. ([validated by creates an agent (admin tier) and audits it](../../apps/mcp-server/src/api/routes/agents-route.test.ts#L94)) ([validated by two-key gates a create that sets an image (no approval header)](../../apps/mcp-server/src/api/routes/agents-route.test.ts#L112)) ([validated by deletes an agent by name](../../apps/mcp-server/src/api/routes/agents-route.test.ts#L141))
- **FR11 — Floor prompt resolution.** The worker/handler build the prompt from
  the resolved definition, falling back to the yaml template. ([validated by substitutes {description} into the resolved agent's prompt](../../apps/floor/src/data/agent-invocation.test.ts#L5)) ([validated by falls back to the yaml task-type template when the definition has no prompt](../../apps/floor/src/data/agent-invocation.test.ts#L11))
- **FR12 — Migration seed + backfill.** Migration 0015 seeds an org row per task
  type (idempotently) and backfills existing `task_overrides` into project rows. ([validated by seeds an org row for every task-types.yaml task type, idempotently](../../apps/mcp-server/src/features/agents/migration-0015.test.ts#L21)) ([validated by backfills existing settings.task_overrides into per-project rows](../../apps/mcp-server/src/features/agents/migration-0015.test.ts#L31))
- **FR13 — Agents tab.** The tab renders one editable card per resolved agent,
  prefilled. ([validated by renders an agent card per resolved agent, prefilled, in the Agents tab](../../apps/web-ui/src/app/repos/[owner]/[repo]/settings/SettingsView.test.tsx#L76))
- **FR14 — Card editing.** A card reveals a custom-model input on "Custom…" and
  leaves an inherited prompt empty with the base as placeholder. ([validated by reveals the custom model input only when Custom… is selected](../../apps/web-ui/src/app/repos/[owner]/[repo]/settings/AgentCard.test.tsx#L20)) ([validated by leaves an inherited prompt empty with the base as placeholder](../../apps/web-ui/src/app/repos/[owner]/[repo]/settings/AgentCard.test.tsx#L28))

## Verification (manual / integration)

Migration 0015 applied to a throwaway Postgres confirmed the org seed (10 rows),
the `task_overrides` backfill, idempotency, and the project-over-org resolve
query (documented in the PR). Suites green: shared, mcp-server, floor, web-ui.
