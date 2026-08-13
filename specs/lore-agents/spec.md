# Feature Specification: Agent definitions as data (lore.agent_definitions)

| Field    | Value                          |
|----------|--------------------------------|
| Feature  | Agent definitions as data      |
| Branch   | feat/lore-agents-table         |
| Status   | In Progress                  |
| Created  | 2026-06-16                     |
| Owner    | Platform Engineering           |
| ADR      | ADR-024                        |

This spec promotes per-task-type agent behaviour — model, timeout, prompt, and container image — out of the hardcoded `task-types.yaml` into a first-class `lore.agent_definitions` table with per-repo overrides, a dedicated Agents settings tab, and a `/lore-agents` skill, so operators can retune a repo's agents without a source edit and redeploy.

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
`(name, project_id)`. ([validated by `migration-0015.test.ts:18`](apps/lore-api/src/features/agents/migration-0015.test.ts#L18))

Migration 0016 renames a pre-existing `lore.agents` table and its two partial
indexes to `agent_definitions`, every DDL statement guarded with `IF EXISTS` so it
no-ops on a fresh DB that already built the new name from 0015. ([validated by `migration-0016.test.ts:20`](apps/lore-api/src/features/agents/migration-0016.test.ts#L20), [validated by `migration-0016.test.ts:32`](apps/lore-api/src/features/agents/migration-0016.test.ts#L32))

## Requirements

- **FR1 — Port-only access.** Agent-definition config is reached only through
  `project.agentDefs` (`resolve`/`list`/`create`/`update`/`delete`); no consumer
  reads `lore.agent_definitions` directly. ([validated by `agent-defs.test.ts:49`](libs/shared/src/project/agents/agent-defs.test.ts#L49))
- **FR2 — Precedence.** Resolution field-merges project → org → yaml; a null
  nullable field on a layer inherits the next layer down. ([validated by `agent-defs-port.test.ts:43`](libs/shared/src/project/agents/agent-defs-port.test.ts#L43))
- **FR3 — DB adapter merge.** `PgAgentDefs` field-merges the repo's project row
  over the org row over the yaml base. ([validated by `agent-defs-pg.test.ts:82`](libs/shared/src/project/agents/agent-defs-pg.test.ts#L82))
- **FR4 — Yaml prompt inheritance.** A seeded org row that leaves `prompt` null
  inherits the prompt from the yaml base. ([validated by `agent-defs-pg.test.ts:68`](libs/shared/src/project/agents/agent-defs-pg.test.ts#L68))
- **FR5 — Offline fallback.** `AgentDefsYaml` resolves task types from
  `task-types.yaml` and refuses writes (read-only without a DB). ([validated by `agent-defs-yaml.test.ts:133`](libs/shared/src/project/agents/agent-defs-yaml.test.ts#L134))
- **FR5a — Base task-types reader.** The `pipeline-config` reader that
  `AgentDefsYaml` resolves over parses the project's `task-types.yaml`
  (`loadTaskTypes`, pointed at by `TASK_TYPES_PATH`), loading an empty config
  without throwing when the file is missing; `getTaskTypeConfig(type)` returns a
  known type's config (null for an unknown type) — an `implementation` type
  carries `execution_mode: claude-code`, a `review` type a configured timeout,
  and every claude-code type a `prompt_template`; `buildPrompt` substitutes
  `{description}` into that template (preserving the surrounding structure,
  tolerating empty or special-character descriptions) and falls back to the
  default template for an unknown type; `getDefaultRepo(type)` returns a type's
  configured default repo, falling back to `re-cinq/lore`. ([validated by `loads task types from the project's YAML file`](libs/server-core/src/features/pipeline/pipeline-config.test.ts#L20), [validated by `handles missing YAML gracefully`](libs/server-core/src/features/pipeline/pipeline-config.test.ts#L46), [validated by `returns config for a known task type`](libs/server-core/src/features/pipeline/pipeline-config.test.ts#L92), [validated by `returns null for unknown task type`](libs/server-core/src/features/pipeline/pipeline-config.test.ts#L101), [validated by `implementation type has claude-code execution mode`](libs/server-core/src/features/pipeline/pipeline-config.test.ts#L105), [validated by `review type has timeout configured`](libs/server-core/src/features/pipeline/pipeline-config.test.ts#L112), [validated by `each claude-code task type has a prompt_template`](libs/server-core/src/features/pipeline/pipeline-config.test.ts#L119), [validated by `substitutes {description} in the template`](libs/server-core/src/features/pipeline/pipeline-config.test.ts#L158), [validated by `falls back to default template for unknown type`](libs/server-core/src/features/pipeline/pipeline-config.test.ts#L165), [validated by `preserves template structure around the description`](libs/server-core/src/features/pipeline/pipeline-config.test.ts#L173), [validated by `handles empty description`](libs/server-core/src/features/pipeline/pipeline-config.test.ts#L181), [validated by `handles description with special characters`](libs/server-core/src/features/pipeline/pipeline-config.test.ts#L188), [validated by `returns configured default repo`](libs/server-core/src/features/pipeline/pipeline-config.test.ts#L217), [validated by `falls back to re-cinq/lore for unknown types`](libs/server-core/src/features/pipeline/pipeline-config.test.ts#L223); implemented by [`pipeline-config.ts:1`](libs/server-core/src/features/pipeline/pipeline-config.ts#L1))
- **FR6 — Runner fetches over the API.** `AgentDefsHttp` resolves an agent by
  fetching the agent-definitions endpoint with the bearer token and is read-only. ([validated by `agent-defs-http.test.ts:78`](libs/shared/src/project/agents/agent-defs-http.test.ts#L78))
- **FR7 — Facade delegation.** `project.agentDefs` delegates the definition methods
  to the wired port, bound to the facade's repo. ([validated by delegates create/delete to the defs port with the bound repo](libs/shared/src/project/agents/agent-defs.test.ts#L48))
- **FR8 — Request validation + image gate.** The schema normalizes the body and
  flags a write that sets a non-empty `image` (two-key field), normalizing a full
  body onto null-for-absent fields, rejecting an over-ceiling timeout, keeping only
  the fields present on a patch, and never flagging a null/empty image; the route
  rejects an invalid body with `400 invalid_agent`. ([validated by flags a write that sets a non-empty image](apps/lore-api/src/features/agents/agents-schema.test.ts#L47), [validated by `agents-schema.test.ts:27`](apps/lore-api/src/features/agents/agents-schema.test.ts#L27), [validated by `agents-schema.test.ts:9`](apps/lore-api/src/features/agents/agents-schema.test.ts#L9), [validated by `agents-schema.test.ts:31`](apps/lore-api/src/features/agents/agents-schema.test.ts#L31), [validated by `agents-schema.test.ts:39`](apps/lore-api/src/features/agents/agents-schema.test.ts#L39), [validated by `agents-schema.test.ts:51`](apps/lore-api/src/features/agents/agents-schema.test.ts#L51), [validated by `agents-route.test.ts:147`](apps/lore-api/src/api/routes/agent-definitions/agents-route.test.ts#L147))
- **FR9 — Authorization scope.** GET (resolve/list) is read-scoped; agent writes
  are admin-scoped; the GET surface lists the repo's resolved agents and returns
  `404` for an unknown name. ([validated by resolves one agent by name (GET, read scope)](apps/lore-api/src/api/routes/agent-definitions/agents-route.test.ts#L107), [validated by creates an agent (admin tier) and audits it](apps/lore-api/src/api/routes/agent-definitions/agents-route.test.ts#L128), [validated by `agents-route.test.ts:100`](apps/lore-api/src/api/routes/agent-definitions/agents-route.test.ts#L100), [validated by `agents-route.test.ts:115`](apps/lore-api/src/api/routes/agent-definitions/agents-route.test.ts#L115))
- **FR10 — API delegates + audits + two-key.** The route delegates CRUD to
  `project.agentDefs`, audits writes, and two-key gates an image change — applying
  an image create only after CODEOWNERS approval and returning `403` on a CODEOWNERS
  failure — updates an agent by name, and returns `503` without a DB pool. ([validated by creates an agent (admin tier) and audits it](apps/lore-api/src/api/routes/agent-definitions/agents-route.test.ts#L128), [validated by two-key gates a create that sets an image (no approval header)](apps/lore-api/src/api/routes/agent-definitions/agents-route.test.ts#L154), [validated by `agents-route.test.ts:220`](apps/lore-api/src/api/routes/agent-definitions/agents-route.test.ts#L220), [validated by `agents-route.test.ts:165`](apps/lore-api/src/api/routes/agent-definitions/agents-route.test.ts#L165), [validated by `agents-route.test.ts:190`](apps/lore-api/src/api/routes/agent-definitions/agents-route.test.ts#L190), [validated by `agents-route.test.ts:208`](apps/lore-api/src/api/routes/agent-definitions/agents-route.test.ts#L208), [validated by `agents-route.test.ts:89`](apps/lore-api/src/api/routes/agent-definitions/agents-route.test.ts#L89))
- **FR11 — Floor prompt resolution.** The worker/handler build the prompt from
  the resolved definition, falling back to the yaml template. ([validated by substitutes {description} into the resolved agent's prompt](apps/floor/src/kernel/agent-invocation.test.ts#L5), [validated by falls back to the yaml task-type template when the definition has no prompt](apps/floor/src/kernel/agent-invocation.test.ts#L11))
- **FR12 — Migration seed + backfill.** Migration 0015 seeds an org row per task
  type (idempotently) and backfills existing `task_overrides` into project rows,
  granting `lore_ui` SELECT only inside a role-exists guard. ([validated by seeds an org row for every task-types.yaml task type, idempotently](apps/lore-api/src/features/agents/migration-0015.test.ts#L28), [validated by `migration-0015.test.ts:48`](apps/lore-api/src/features/agents/migration-0015.test.ts#L48), [validated by `migration-0015.test.ts:58`](apps/lore-api/src/features/agents/migration-0015.test.ts#L58))
- **FR13 — Agents list.** The `/agents` page lists resolved agent definitions, labelling an inherited one `org` and an overridden one `project`, with a per-card edit link; the New-definition action sits in the section header, and an empty list renders a "no agent definitions resolved" state. ([validated by labels an inherited agent "org" and an overridden one "project"](apps/web-ui/src/app/repos/[owner]/[repo]/agents/AgentList.test.tsx#L21), [validated by links each card to its edit page](apps/web-ui/src/app/repos/[owner]/[repo]/agents/AgentList.test.tsx#L32), [validated by shows an empty state when there are no agent definitions](apps/web-ui/src/app/repos/[owner]/[repo]/agents/AgentList.test.tsx#L41))
- **FR14 — New/edit form.** Create/edit happen on dedicated pages: an editable name on create, locked on edit, model dropdown + custom escape hatch, and the default runner image surfaced as a non-prefilled placeholder. ([validated by shows an editable name input in create mode](apps/web-ui/src/app/repos/[owner]/[repo]/agents/AgentForm.test.tsx#L20), [validated by locks the name on edit and prefills the model](apps/web-ui/src/app/repos/[owner]/[repo]/agents/AgentForm.test.tsx#L32), [validated by reveals the custom model input only when Custom… is chosen](apps/web-ui/src/app/repos/[owner]/[repo]/agents/AgentForm.test.tsx#L54), [validated by starts on Custom… when the model is not in the curated list](apps/web-ui/src/app/repos/[owner]/[repo]/agents/AgentForm.test.tsx#L73), [validated by shows the default runner image as the image placeholder without prefilling it](apps/web-ui/src/app/repos/[owner]/[repo]/agents/AgentForm.test.tsx#L153))
- **FR15 — Form parsing.** The page server actions parse the form into an agent payload (custom model, inherited nulls) and map save results to UI state. ([validated by reads name_input on create and normalizes the curated model](apps/web-ui/src/lib/agents-form.test.ts#L15), [validated by reads the hidden name on edit and the custom model field](apps/web-ui/src/lib/agents-form.test.ts#L38), [validated by inherits (null) when model/timeout/prompt/image are blank](apps/web-ui/src/lib/agents-form.test.ts#L53), [validated by carries the approval PR and preserves execution_mode/review_required](apps/web-ui/src/lib/agents-form.test.ts#L67), [validated by maps ok to an empty state (page redirects)](apps/web-ui/src/lib/agents-form.test.ts#L86), [validated by maps two_key_required to a twoKey flag](apps/web-ui/src/lib/agents-form.test.ts#L89), [validated by maps unconfigured + codeowners + error to messages](apps/web-ui/src/lib/agents-form.test.ts#L94))
- **FR16 — Dark Factory tab.** Dark-factory autonomy is its own repo tab, prefilled from resolved settings, with the approval-PR input for gated changes. ([validated by `DarkFactoryView.test.tsx:78`](apps/web-ui/src/app/repos/[owner]/[repo]/dark-factory/settings/DarkFactoryView.test.tsx#L78))

- **FR17 — Edit-form provenance + error feedback.** The edit form notes whether
  the agent is inherited from the org default, is a project override for this repo,
  or is brand new (no note), and surfaces an action error inline on submit. ([validated by notes that values are inherited from org when editing an org agent](apps/web-ui/src/app/repos/[owner]/[repo]/agents/AgentForm.test.tsx#L99), [validated by notes a project override when editing an already-overridden agent](apps/web-ui/src/app/repos/[owner]/[repo]/agents/AgentForm.test.tsx#L114), [validated by shows no inherited/override note on a new agent](apps/web-ui/src/app/repos/[owner]/[repo]/agents/AgentForm.test.tsx#L129), [validated by surfaces an error returned by the action](apps/web-ui/src/app/repos/[owner]/[repo]/agents/AgentForm.test.tsx#L138))

- **FR18 — Agent memory detail view.** The `/agents/[id]` view renders the truncated
  agent id + memory count and, per memory, the key with facts/TTL/version badges,
  the current value, version history and extracted-facts list — each conditional on
  the memory carrying that data — and an empty state for zero memories. ([validated by renders truncated agent id and memory count](apps/web-ui/src/app/agents/[id]/AgentDetailView.test.tsx#L59), [validated by renders key, version meta, facts badge and TTL badge for a full memory](apps/web-ui/src/app/agents/[id]/AgentDetailView.test.tsx#L73), [validated by renders current value and version history when more than one version](apps/web-ui/src/app/agents/[id]/AgentDetailView.test.tsx#L87), [validated by renders extracted facts list when facts present](apps/web-ui/src/app/agents/[id]/AgentDetailView.test.tsx#L102), [validated by omits version history, facts badge, TTL badge and facts section for a minimal memory](apps/web-ui/src/app/agents/[id]/AgentDetailView.test.tsx#L117), [validated by renders empty state with zero memories and no cards](apps/web-ui/src/app/agents/[id]/AgentDetailView.test.tsx#L134))

- **FR19 — Agents table chrome.** The shared `AgentsTable` renders a heading (custom
  title supported), help popover and optional intro, drops that chrome when embedded
  while keeping the table, and shows a `Why` column with a reason badge + truncated
  text only when a row carries a reason. ([validated by renders the heading, help popover and optional intro](apps/web-ui/src/components/AgentsTable.test.tsx#L31), [validated by omits the intro line when no intro is given](apps/web-ui/src/components/AgentsTable.test.tsx#L42), [validated by renders a custom heading title](apps/web-ui/src/components/AgentsTable.test.tsx#L48), [validated by drops the heading, help popover and intro when embedded but keeps the table](apps/web-ui/src/components/AgentsTable.test.tsx#L55), [validated by renders the base column headers without a Why column when no reason is present](apps/web-ui/src/components/AgentsTable.test.tsx#L65), [validated by renders the Why column with a reason badge and truncated text when a reason is present](apps/web-ui/src/components/AgentsTable.test.tsx#L87))

- **FR20 — Agents table rows, toggle + empty states.** `AgentsTable` shows local
  agents by default and hides task agents behind a labelled toggle (hidden count,
  aria-pressed flip), renders per-row kind badge, encoded link, counts and
  four-decimal cost with unknown-creator/em-dash fallbacks, and an empty-state row
  when no agents are visible. ([validated by shows only local agents by default and hides task agents behind the toggle](apps/web-ui/src/components/AgentsTable.test.tsx#L113), [validated by labels the toggle with the hidden task-agent count](apps/web-ui/src/components/AgentsTable.test.tsx#L123), [validated by reveals task agents and flips the label when the toggle is clicked](apps/web-ui/src/components/AgentsTable.test.tsx#L136), [validated by renders no toggle when there are no task agents](apps/web-ui/src/components/AgentsTable.test.tsx#L157), [validated by renders the kind badge, encoded link, counts and cost per row](apps/web-ui/src/components/AgentsTable.test.tsx#L166), [validated by renders the Task badge and four-decimal cost for a revealed task agent](apps/web-ui/src/components/AgentsTable.test.tsx#L183), [validated by falls back to unknown creator and an em dash when last_active is null](apps/web-ui/src/components/AgentsTable.test.tsx#L190), [validated by shows the empty-state row when there are no agents](apps/web-ui/src/components/AgentsTable.test.tsx#L200), [validated by shows the empty-state row when only hidden task agents exist](apps/web-ui/src/components/AgentsTable.test.tsx#L205))

- **FR21 — Web-ui list client.** `listAgents` reads the agents envelope over the API
  with the admin token (falling back to the legacy ingest token in local dev) and
  degrades to `[]` on missing env, a non-ok response, a thrown fetch, or an envelope
  without an agents key. ([validated by `agents-api.test.ts:38`](apps/web-ui/src/lib/agents-api.test.ts#L38), [`agents-api.test.ts:43`](apps/web-ui/src/lib/agents-api.test.ts#L43), [`agents-api.test.ts:48`](apps/web-ui/src/lib/agents-api.test.ts#L48), [`agents-api.test.ts:69`](apps/web-ui/src/lib/agents-api.test.ts#L69), [`agents-api.test.ts:74`](apps/web-ui/src/lib/agents-api.test.ts#L74), [`agents-api.test.ts:81`](apps/web-ui/src/lib/agents-api.test.ts#L81))

- **FR22 — Web-ui write client.** `saveAgent` POSTs a create to the collection and
  PUTs an update to the named resource carrying the approval header, and both it and
  `deleteAgent` map unconfigured env, two-key/codeowners 403s, other non-ok
  responses and thrown fetches to typed results. ([validated by returns unconfigured when env is missing](apps/web-ui/src/lib/agents-api.test.ts#L88), [validated by POSTs to the collection on create and returns ok](apps/web-ui/src/lib/agents-api.test.ts#L95), [validated by PUTs to the named resource on update with the approval header](apps/web-ui/src/lib/agents-api.test.ts#L112), [validated by maps 403 two_key_required](apps/web-ui/src/lib/agents-api.test.ts#L137), [validated by maps 403 codeowners_check_failed](apps/web-ui/src/lib/agents-api.test.ts#L144), [validated by maps other non-ok responses to an error](apps/web-ui/src/lib/agents-api.test.ts#L159), [validated by returns an error when fetch throws](apps/web-ui/src/lib/agents-api.test.ts#L167), [validated by returns unconfigured when env is missing](apps/web-ui/src/lib/agents-api.test.ts#L179), [validated by returns ok on a 200](apps/web-ui/src/lib/agents-api.test.ts#L186), [validated by maps a non-ok response to an error](apps/web-ui/src/lib/agents-api.test.ts#L194), [validated by returns an error when fetch throws](apps/web-ui/src/lib/agents-api.test.ts#L202))

## Verification (manual / integration)

Migration 0015 applied to a throwaway Postgres confirmed the org seed (10 rows),
the `task_overrides` backfill, idempotency, and the project-over-org resolve
query (documented in the PR). Suites green: shared, mcp-server, floor, web-ui.
