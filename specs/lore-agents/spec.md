# Feature Specification: Agent definitions as data (lore.agent_definitions)

| Field    | Value                          |
|----------|--------------------------------|
| Feature  | Agent definitions as data      |
| Branch   | feat/lore-agents-table         |
| Status   | Shipped                      |
| Created  | 2026-06-16                     |
| Owner    | Platform Engineering           |
| ADR      | ADR-024                        |

## Why

Per-task-type behaviour (model, timeout, prompt, container image) was hardcoded
in `scripts/task-types.yaml` and only thinly overridable per repo via a JSONB
blob. Operators could not define or retune a repo's agents without a source edit
and redeploy. This promotes **agent definitions** to first-class, per-repo data
— a real `lore.agent_definitions` table, a dedicated **Agents** settings tab, and
a `/lore-agents` skill — reached only through the `project.agentDefs` port (the
config side; `project.agents.run()` stays the execution side). See ADR-024
([Agent definitions as data](../../adrs/ADR-024-ubiquitous-language-execution-model.md#agent-definitions-as-data)).

## Scope

In (this PR): the `lore.agent_definitions` table; resolution (project → org → yaml)
via `project.agentDefs`; the agent-definitions HTTP API; the per-repo **Agents**
nav tab (list with
org/project labels + dedicated new/edit form pages with breadcrumbs); a separate
**Dark Factory** nav tab (the gated autonomy settings, moved out of Settings, which
now holds only general options); the `/lore-agents` skill; floor + runner
resolution through the port.

Out (Phase 2): the `.lore/workflows/` loader (repo > built-in) and the workflow
`on:` triggers + event-dispatch registry. The agent carries neither a `workflow`
nor a `trigger` column — both belong on the workflow.

## Data model

`lore.agent_definitions(id, name, model, timeout_minutes, prompt, image, project_id,
execution_mode, review_required, created_at, updated_at)`. `project_id = NULL` is
the organisation default; a `project_id` (→ `lore.repos.id`) is a repo override.
Partial unique indexes: one org default per `name`; one override per
`(name, project_id)`.

## Requirements

- **FR1 — Port-only access.** Agent-definition config is reached only through
  `project.agentDefs` (`resolve`/`list`/`create`/`update`/`delete`); no consumer
  reads `lore.agent_definitions` directly. ([validated by resolves a definition bound to the facade's repo](../../libs/shared/src/project/agents/agent-defs.test.ts#L32))
- **FR2 — Precedence.** Resolution field-merges project → org → yaml; a null
  nullable field on a layer inherits the next layer down. ([validated by lets a project row's set fields beat the org row](../../libs/shared/src/project/agents/agent-defs-port.test.ts#L37))
- **FR3 — DB adapter merge.** `PgAgentDefs` field-merges the repo's project row
  over the org row over the yaml base. ([validated by merges a project row over the org default and yaml base](../../libs/shared/src/project/agents/agent-defs-pg.test.ts#L71))
- **FR4 — Yaml prompt inheritance.** A seeded org row that leaves `prompt` null
  inherits the prompt from the yaml base. ([validated by resolves the org row and inherits the prompt from the yaml base](../../libs/shared/src/project/agents/agent-defs-pg.test.ts#L60))
- **FR5 — Offline fallback.** `AgentDefsYaml` resolves task types from
  `task-types.yaml` and refuses writes (read-only without a DB). ([validated by resolves a task type into an org-level definition](../../libs/shared/src/project/agents/agent-defs-yaml.test.ts#L41)) ([validated by refuses writes without a database](../../libs/shared/src/project/agents/agent-defs-yaml.test.ts#L79))
- **FR6 — Runner fetches over the API.** `AgentDefsHttp` resolves an agent by
  fetching the agent-definitions endpoint with the bearer token and is read-only. ([validated by resolves an agent by fetching the API with the bearer token](../../libs/shared/src/project/agents/agent-defs-http.test.ts#L48)) ([validated by refuses writes from a runner](../../libs/shared/src/project/agents/agent-defs-http.test.ts#L65))
- **FR7 — Facade delegation.** `project.agentDefs` delegates the definition methods
  to the wired port, bound to the facade's repo. ([validated by delegates create/delete to the defs port with the bound repo](../../libs/shared/src/project/agents/agent-defs.test.ts#L48))
- **FR8 — Request validation + image gate.** The schema normalizes the body and
  flags a write that sets a non-empty `image` (two-key field). ([validated by flags a write that sets a non-empty image](../../apps/mcp-server/src/features/agents/agents-schema.test.ts#L37)) ([validated by rejects a non-kebab-case name](../../apps/mcp-server/src/features/agents/agents-schema.test.ts#L19))
- **FR9 — Authorization scope.** GET (resolve/list) is read-scoped; agent writes
  are admin-scoped. ([validated by returns read for a GET on the agent-definitions route (runner resolve)](../../apps/mcp-server/src/api/routes/auth.test.ts#L33)) ([validated by returns admin for agent writes](../../apps/mcp-server/src/api/routes/auth.test.ts#L38))
- **FR10 — API delegates + audits + two-key.** The route delegates CRUD to
  `project.agentDefs`, audits writes, and two-key gates an image change. ([validated by creates an agent (admin tier) and audits it](../../apps/mcp-server/src/api/routes/agents-route.test.ts#L94)) ([validated by two-key gates a create that sets an image (no approval header)](../../apps/mcp-server/src/api/routes/agents-route.test.ts#L112)) ([validated by deletes an agent by name](../../apps/mcp-server/src/api/routes/agents-route.test.ts#L141))
- **FR11 — Floor prompt resolution.** The worker/handler build the prompt from
  the resolved definition, falling back to the yaml template. ([validated by substitutes {description} into the resolved agent's prompt](../../apps/floor/src/data/agent-invocation.test.ts#L5)) ([validated by falls back to the yaml task-type template when the definition has no prompt](../../apps/floor/src/data/agent-invocation.test.ts#L11))
- **FR12 — Migration seed + backfill.** Migration 0015 seeds an org row per task
  type (idempotently) and backfills existing `task_overrides` into project rows. ([validated by seeds an org row for every task-types.yaml task type, idempotently](../../apps/mcp-server/src/features/agents/migration-0015.test.ts#L21)) ([validated by backfills existing settings.task_overrides into per-project rows](../../apps/mcp-server/src/features/agents/migration-0015.test.ts#L31))
- **FR13 — Agents list.** The `/agents` page lists resolved agent definitions, labelling an inherited one `org` and an overridden one `project`, with a per-card edit link; the New-definition action sits in the section header. ([validated by labels an inherited agent "org" and an overridden one "project"](../../apps/web-ui/src/app/repos/[owner]/[repo]/agents/AgentList.test.tsx#L15)) ([validated by links each card to its edit page](../../apps/web-ui/src/app/repos/[owner]/[repo]/agents/AgentList.test.tsx#L21))
- **FR14 — New/edit form.** Create/edit happen on dedicated pages: an editable name on create, locked on edit, model dropdown + custom escape hatch. ([validated by shows an editable name input in create mode](../../apps/web-ui/src/app/repos/[owner]/[repo]/agents/AgentForm.test.tsx#L14)) ([validated by reveals the custom model input only when Custom… is chosen](../../apps/web-ui/src/app/repos/[owner]/[repo]/agents/AgentForm.test.tsx#L27))
- **FR15 — Form parsing.** The page server actions parse the form into an agent payload (custom model, inherited nulls) and map save results to UI state. ([validated by reads the hidden name on edit and the custom model field](../../apps/web-ui/src/lib/agents-form.test.ts#L20)) ([validated by maps two_key_required to a twoKey flag](../../apps/web-ui/src/lib/agents-form.test.ts#L45))
- **FR16 — Dark Factory tab.** Dark-factory autonomy is its own repo tab, prefilled from resolved settings, with the approval-PR input for gated changes. ([validated by prefills the dark-factory fields from resolved defaults (opt-out posture)](../../apps/web-ui/src/app/repos/[owner]/[repo]/dark-factory/DarkFactoryView.test.tsx#L23)) ([validated by exposes the approval-PR input for gated changes](../../apps/web-ui/src/app/repos/[owner]/[repo]/dark-factory/DarkFactoryView.test.tsx#L44))

## Verification (manual / integration)

Migration 0015 applied to a throwaway Postgres confirmed the org seed (10 rows),
the `task_overrides` backfill, idempotency, and the project-over-org resolve
query (documented in the PR). Suites green: shared, mcp-server, floor, web-ui.
