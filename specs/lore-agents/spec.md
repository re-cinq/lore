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
`(name, project_id)`. ([validated by `migration-0015.test.ts:18`](apps/lore-api/src/features/agents/migration-0015.test.ts#L14))

Migration 0016 renames a pre-existing `lore.agents` table and its two partial
indexes to `agent_definitions`, every DDL statement guarded with `IF EXISTS` so it
no-ops on a fresh DB that already built the new name from 0015. ([validated by `migration-0016.test.ts:20`](apps/lore-api/src/features/agents/migration-0016.test.ts#L14), [validated by `migration-0016.test.ts:32`](apps/lore-api/src/features/agents/migration-0016.test.ts#L26))

## Requirements

- **FR1 — Port-only access.** Agent-definition config is reached only through
  `project.agentDefs` (`resolve`/`list`/`create`/`update`/`delete`); no consumer
  reads `lore.agent_definitions` directly. ([validated by `agent-defs.test.ts:49`](libs/shared/src/project/agents/agent-defs.test.ts#L44))
- **FR2 — Precedence.** Resolution field-merges project → org → yaml; a null
  nullable field on a layer inherits the next layer down. ([validated by `agent-defs-port.test.ts:37`](libs/shared/src/project/agents/agent-defs-port.test.ts#L37))
- **FR3 — DB adapter merge.** `PgAgentDefs` field-merges the repo's project row
  over the org row over the yaml base; its writes target the repo's own project row, so a delete removes only that repo's override. ([validated by `agent-defs-pg.test.ts:66`](libs/shared/src/project/agents/agent-defs-pg.test.ts#L66), [validated by deletes the repo's project row for a name, scoped to the repo](libs/shared/src/project/agents/agent-defs-pg.test.ts#L162))
- **FR4 — Yaml prompt inheritance.** A seeded org row that leaves `prompt` null
  inherits the prompt from the yaml base. ([validated by `agent-defs-pg.test.ts:66`](libs/shared/src/project/agents/agent-defs-pg.test.ts#L66))
- **FR5 — Offline fallback.** `AgentDefsYaml` resolves task types from
  `task-types.yaml` and refuses writes (read-only without a DB). ([validated by `agent-defs-yaml.test.ts:133`](libs/shared/src/project/agents/agent-defs-yaml.test.ts#L130))
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
  configured default repo, falling back to `re-cinq/lore`; `getTaskTypeConfigForRepo(type, repoSettings)`
  merges a repo's `task_overrides[type]` onto the base recipe (falling back to a
  built-in default recipe for an unknown type with no repo settings), keeping the
  base `prompt_template` unless the override sets its own. ([validated by `loads task types from the project's YAML file`](libs/server-core/src/features/pipeline/pipeline-config.test.ts#L17), [validated by `handles missing YAML gracefully`](libs/server-core/src/features/pipeline/pipeline-config.test.ts#L42), [validated by `returns config for a known task type`](libs/server-core/src/features/pipeline/pipeline-config.test.ts#L79), [validated by `returns null for unknown task type`](libs/server-core/src/features/pipeline/pipeline-config.test.ts#L88), [validated by `implementation type has claude-code execution mode`](libs/server-core/src/features/pipeline/pipeline-config.test.ts#L92), [validated by `review type has timeout configured`](libs/server-core/src/features/pipeline/pipeline-config.test.ts#L99), [validated by `each claude-code task type has a prompt_template`](libs/server-core/src/features/pipeline/pipeline-config.test.ts#L106), [validated by `substitutes {description} in the template`](libs/server-core/src/features/pipeline/pipeline-config.test.ts#L140), [validated by `falls back to default template for unknown type`](libs/server-core/src/features/pipeline/pipeline-config.test.ts#L147), [validated by `preserves template structure around the description`](libs/server-core/src/features/pipeline/pipeline-config.test.ts#L154), [validated by `handles empty description`](libs/server-core/src/features/pipeline/pipeline-config.test.ts#L161), [validated by `handles description with special characters`](libs/server-core/src/features/pipeline/pipeline-config.test.ts#L167), [validated by `returns configured default repo`](libs/server-core/src/features/pipeline/pipeline-config.test.ts#L192), [validated by `falls back to re-cinq/lore for unknown types`](libs/server-core/src/features/pipeline/pipeline-config.test.ts#L198), [validated by `returns base config unchanged when repoSettings is null`](libs/server-core/src/features/pipeline/pipeline-config.test.ts#L220), [validated by `returns default base config for an unknown type with no repoSettings`](libs/server-core/src/features/pipeline/pipeline-config.test.ts#L228), [validated by `applies a per-type override field on top of the base config`](libs/server-core/src/features/pipeline/pipeline-config.test.ts#L238), [validated by `uses the override prompt_template when the repo sets one`](libs/server-core/src/features/pipeline/pipeline-config.test.ts#L246), [validated by `keeps the base prompt_template when overrides omit it`](libs/server-core/src/features/pipeline/pipeline-config.test.ts#L256); implemented by [`pipeline-config.ts:1`](libs/server-core/src/features/pipeline/pipeline-config.ts#L1))
- **FR6 — Runner fetches over the API.** `AgentDefsHttp` resolves an agent by
  fetching the agent-definitions endpoint with the bearer token and is read-only. ([validated by `agent-defs-http.test.ts:79`](libs/shared/src/project/agents/agent-defs-http.test.ts#L79))
- **FR7 — Facade delegation.** `project.agentDefs` delegates the definition methods
  to the wired port, bound to the facade's repo. ([validated by delegates create/delete to the defs port with the bound repo](libs/shared/src/project/agents/agent-defs.test.ts#L63))
- **FR8 — Request validation + image gate.** The schema normalizes the body and
  flags a write that sets a non-empty `image` (two-key field), normalizing a full
  body onto null-for-absent fields, rejecting an over-ceiling timeout, keeping only
  the fields present on a patch, and never flagging a null/empty image; the route
  rejects an invalid body with `400 invalid_agent`. ([validated by flags a write that sets a non-empty image](apps/lore-api/src/features/agents/agents-schema.test.ts#L170), [validated by `agents-schema.test.ts:29`](apps/lore-api/src/features/agents/agents-schema.test.ts#L29), [validated by `agents-schema.test.ts:10`](apps/lore-api/src/features/agents/agents-schema.test.ts#L10), [validated by `agents-schema.test.ts:33`](apps/lore-api/src/features/agents/agents-schema.test.ts#L33), [validated by `agents-schema.test.ts:62`](apps/lore-api/src/features/agents/agents-schema.test.ts#L74), [validated by `agents-schema.test.ts:126`](apps/lore-api/src/features/agents/agents-schema.test.ts#L174), [validated by `agents-route.test.ts:148`](apps/lore-api/src/api/routes/agent-definitions/agents-route.test.ts#L148), [validated by rejects an invalid update body with 400](apps/lore-api/src/api/routes/agent-definitions/agents-route.test.ts#L272), [validated by carries every scalar field present in the body](apps/lore-api/src/features/agents/agents-schema.test.ts#L102), [validated by clears nullable fields when explicitly set to null](apps/lore-api/src/features/agents/agents-schema.test.ts#L122))
- **FR9 — Authorization scope.** GET (resolve/list) is read-scoped; agent writes
  are admin-scoped; the GET surface lists the repo's resolved agents and returns
  `404` for an unknown name. ([validated by resolves one agent by name (GET, read scope)](apps/lore-api/src/api/routes/agent-definitions/agents-route.test.ts#L108), [validated by creates an agent (admin tier) and audits it](apps/lore-api/src/api/routes/agent-definitions/agents-route.test.ts#L129), [validated by `agents-route.test.ts:101`](apps/lore-api/src/api/routes/agent-definitions/agents-route.test.ts#L101), [validated by `agents-route.test.ts:116`](apps/lore-api/src/api/routes/agent-definitions/agents-route.test.ts#L116))
- **FR10 — API delegates + audits + two-key.** The route delegates CRUD to
  `project.agentDefs`, audits writes, and two-key gates an image change — applying
  an image create only after CODEOWNERS approval and returning `403` on a CODEOWNERS
  failure — updates an agent by name, and returns `503` without a DB pool. ([validated by creates an agent (admin tier) and audits it](apps/lore-api/src/api/routes/agent-definitions/agents-route.test.ts#L129), [validated by two-key gates a create that sets an image (no approval header)](apps/lore-api/src/api/routes/agent-definitions/agents-route.test.ts#L155), [validated by `agents-route.test.ts:270`](apps/lore-api/src/api/routes/agent-definitions/agents-route.test.ts#L328), [validated by `agents-route.test.ts:166`](apps/lore-api/src/api/routes/agent-definitions/agents-route.test.ts#L166), [validated by `agents-route.test.ts:191`](apps/lore-api/src/api/routes/agent-definitions/agents-route.test.ts#L191), [validated by `agents-route.test.ts:209`](apps/lore-api/src/api/routes/agent-definitions/agents-route.test.ts#L209), [validated by two-key gates an update that sets an image (no approval header)](apps/lore-api/src/api/routes/agent-definitions/agents-route.test.ts#L223), [validated by applies an image update after CODEOWNERS approval](apps/lore-api/src/api/routes/agent-definitions/agents-route.test.ts#L233), [validated by returns 403 on a CODEOWNERS failure for an image update](apps/lore-api/src/api/routes/agent-definitions/agents-route.test.ts#L254), [validated by `agents-route.test.ts:90`](apps/lore-api/src/api/routes/agent-definitions/agents-route.test.ts#L90))
- **FR11 — Floor prompt resolution.** The worker/handler build the prompt from
  the resolved definition, falling back to the yaml template. ([validated by substitutes {description} into the resolved agent's prompt](apps/floor/src/kernel/agent-invocation.test.ts#L5), [validated by falls back to the yaml task-type template when the definition has no prompt](apps/floor/src/kernel/agent-invocation.test.ts#L11))
- **FR12 — Migration seed + backfill.** Migration 0015 seeds an org row per task
  type (idempotently) and backfills existing `task_overrides` into project rows,
  granting `lore_ui` SELECT only inside a role-exists guard. ([validated by seeds an org row for every task-types.yaml task type, idempotently](apps/lore-api/src/features/agents/migration-0015.test.ts#L24), [validated by `migration-0015.test.ts:48`](apps/lore-api/src/features/agents/migration-0015.test.ts#L44), [validated by `migration-0015.test.ts:58`](apps/lore-api/src/features/agents/migration-0015.test.ts#L54))
- **FR13 — Agents list.** The `/agents` page lists resolved agent definitions, labelling an inherited one `org` and an overridden one `project`, with a per-card edit link; the New-definition action sits in the section header, and an empty list renders a "no agent definitions resolved" state. ([validated by labels an inherited agent "org" and an overridden one "project"](apps/web-ui/src/app/repos/[owner]/[repo]/agents/AgentList.test.tsx#L52), [validated by links each card to its edit page](apps/web-ui/src/app/repos/[owner]/[repo]/agents/AgentList.test.tsx#L63), [validated by shows an empty state when there are no agent definitions](apps/web-ui/src/app/repos/[owner]/[repo]/agents/AgentList.test.tsx#L72))
- **FR14 — New/edit form.** Create/edit happen on dedicated pages: an editable name on create, locked on edit, model dropdown + custom escape hatch, and the default runner image surfaced as a non-prefilled placeholder. ([validated by shows an editable name input in create mode](apps/web-ui/src/app/repos/[owner]/[repo]/agents/AgentForm.test.tsx#L21), [validated by locks the name on edit and prefills the model](apps/web-ui/src/app/repos/[owner]/[repo]/agents/AgentForm.test.tsx#L33), [validated by reveals the custom model input only when Custom… is chosen](apps/web-ui/src/app/repos/[owner]/[repo]/agents/AgentForm.test.tsx#L55), [validated by starts on Custom… when the model is not in the curated list](apps/web-ui/src/app/repos/[owner]/[repo]/agents/AgentForm.test.tsx#L74), [validated by shows the default runner image as the image placeholder without prefilling it](apps/web-ui/src/app/repos/[owner]/[repo]/agents/AgentForm.test.tsx#L211))
- **FR15 — Form parsing.** The page server actions parse the form into an agent payload (custom model, inherited nulls) and map save results to UI state. ([validated by reads name_input on create and normalizes the curated model](apps/web-ui/src/lib/agents-form.test.ts#L15), [validated by reads the hidden name on edit and the custom model field](apps/web-ui/src/lib/agents-form.test.ts#L63), [validated by inherits (null) when model/timeout/prompt/image are blank](apps/web-ui/src/lib/agents-form.test.ts#L78), [validated by carries the approval PR and preserves execution_mode/review_required](apps/web-ui/src/lib/agents-form.test.ts#L92), [validated by maps ok to an empty state (page redirects)](apps/web-ui/src/lib/agents-form.test.ts#L111), [validated by maps two_key_required to a twoKey flag](apps/web-ui/src/lib/agents-form.test.ts#L114), [validated by maps unconfigured + codeowners + error to messages](apps/web-ui/src/lib/agents-form.test.ts#L119))
- **FR16 — Dark Factory tab.** Dark-factory autonomy is its own repo tab, prefilled from resolved settings, with the approval-PR input for gated changes. ([validated by `DarkFactoryView.test.tsx:78`](apps/web-ui/src/app/repos/[owner]/[repo]/dark-factory/settings/DarkFactoryView.test.tsx#L78))

- **FR17 — Edit-form provenance + error feedback.** The edit form notes whether
  the agent is inherited from the org default, is a project override for this repo,
  or is brand new (no note), and surfaces an action error inline on submit. ([validated by notes that values are inherited from org when editing an org agent](apps/web-ui/src/app/repos/[owner]/[repo]/agents/AgentForm.test.tsx#L100), [validated by notes a project override when editing an already-overridden agent](apps/web-ui/src/app/repos/[owner]/[repo]/agents/AgentForm.test.tsx#L115), [validated by shows no inherited/override note on a new agent](apps/web-ui/src/app/repos/[owner]/[repo]/agents/AgentForm.test.tsx#L130), [validated by surfaces an error returned by the action](apps/web-ui/src/app/repos/[owner]/[repo]/agents/AgentForm.test.tsx#L196))

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
  when no agents are visible. ([validated by shows only local agents by default and hides task agents behind the toggle](apps/web-ui/src/components/AgentsTable.test.tsx#L112), [validated by labels the toggle with the hidden task-agent count](apps/web-ui/src/components/AgentsTable.test.tsx#L122), [validated by reveals task agents and flips the label when the toggle is clicked](apps/web-ui/src/components/AgentsTable.test.tsx#L135), [validated by renders no toggle when there are no task agents](apps/web-ui/src/components/AgentsTable.test.tsx#L156), [validated by renders the kind badge, encoded link, counts and cost per row](apps/web-ui/src/components/AgentsTable.test.tsx#L165), [validated by renders the Task badge and four-decimal cost for a revealed task agent](apps/web-ui/src/components/AgentsTable.test.tsx#L182), [validated by falls back to unknown creator and an em dash when last_active is null](apps/web-ui/src/components/AgentsTable.test.tsx#L189), [validated by shows the empty-state row when there are no agents](apps/web-ui/src/components/AgentsTable.test.tsx#L199), [validated by shows the empty-state row when only hidden task agents exist](apps/web-ui/src/components/AgentsTable.test.tsx#L204))

- **FR21 — Web-ui list client.** `listAgents` reads the agents envelope over the API
  with the admin token (falling back to the legacy ingest token in local dev) and
  degrades to `[]` on missing env, a non-ok response, a thrown fetch, or an envelope
  without an agents key. ([validated by `agents-api.test.ts:38`](apps/web-ui/src/lib/agents-api.test.ts#L46), [`agents-api.test.ts:51`](apps/web-ui/src/lib/agents-api.test.ts#L51), [`agents-api.test.ts:56`](apps/web-ui/src/lib/agents-api.test.ts#L56), [`agents-api.test.ts:77`](apps/web-ui/src/lib/agents-api.test.ts#L77), [`agents-api.test.ts:82`](apps/web-ui/src/lib/agents-api.test.ts#L82), [`agents-api.test.ts:89`](apps/web-ui/src/lib/agents-api.test.ts#L89))

- **FR22 — Web-ui write client.** `saveAgent` POSTs a create to the collection and
  PUTs an update to the named resource carrying the approval header, and both it and
  `deleteAgent` map unconfigured env, two-key/codeowners 403s, other non-ok
  responses and thrown fetches to typed results. ([validated by returns unconfigured when env is missing](apps/web-ui/src/lib/agents-api.test.ts#L237), [validated by POSTs to the collection on create and returns ok](apps/web-ui/src/lib/agents-api.test.ts#L244), [validated by PUTs to the named resource on update with the approval header](apps/web-ui/src/lib/agents-api.test.ts#L261), [validated by maps 403 two_key_required](apps/web-ui/src/lib/agents-api.test.ts#L286), [validated by maps 403 codeowners_check_failed](apps/web-ui/src/lib/agents-api.test.ts#L293), [validated by maps other non-ok responses to an error](apps/web-ui/src/lib/agents-api.test.ts#L308), [validated by returns an error when fetch throws](apps/web-ui/src/lib/agents-api.test.ts#L316), [validated by returns unconfigured when env is missing](apps/web-ui/src/lib/agents-api.test.ts#L328), [validated by returns ok on a 200](apps/web-ui/src/lib/agents-api.test.ts#L335), [validated by maps a non-ok response to an error](apps/web-ui/src/lib/agents-api.test.ts#L343), [validated by returns an error when fetch throws](apps/web-ui/src/lib/agents-api.test.ts#L351))

- **FR23 — Pod resources as catalog data.** A definition's pod resources
  (requests/limits, Kubernetes quantity strings) are edited in the agents UI and
  stored on the row, so raising one station's memory ceiling is data that
  survives releases instead of a code change.
  - The form renders six quantity inputs prefilled from the definition's config. ([validated by prefills the pod-resource inputs from the agent's config](apps/web-ui/src/app/repos/[owner]/[repo]/agents/AgentForm.test.tsx#L139))
  - Inputs without a stored value stay empty and show the platform defaults as placeholders. ([validated by renders empty pod-resource inputs with the default limits as placeholders when config carries none](apps/web-ui/src/app/repos/[owner]/[repo]/agents/AgentForm.test.tsx#L167))
  - The server action collects the six inputs into a `pod_resources` payload. ([validated by collects the six pod-resource inputs into pod_resources](apps/web-ui/src/lib/agents-form.test.ts#L38))
  - All inputs blank sends `pod_resources: null`, so a save clears an old value. ([validated by all pod-resource inputs blank sends pod_resources null so a save clears an old value](apps/web-ui/src/lib/agents-form.test.ts#L57))
  - The API keeps the block beside a null config on create — the route merges it over the config the new row inherits — accepts quantities up to the exa suffixes, and rejects a value that is not a Kubernetes quantity string at the edge. ([validated by keeps pod_resources beside a null config on create so the route can merge it over the inherited layer](apps/lore-api/src/features/agents/agents-schema.test.ts#L39), [validated by accepts exa-scale quantities 1E and 2Ei](apps/lore-api/src/features/agents/agents-schema.test.ts#L52), [validated by rejects a pod_resources quantity that is not a Kubernetes quantity string](apps/lore-api/src/features/agents/agents-schema.test.ts#L63))
  - A patch carries `pod_resources` separately when present — null meaning clear — and omits it when absent. ([validated by carries pod_resources when present and omits it when absent](apps/lore-api/src/features/agents/agents-schema.test.ts#L80), [validated by a null pod_resources means clear — carried as null](apps/lore-api/src/features/agents/agents-schema.test.ts#L96))
  - Writes merge the block over the config the row inherits so a project fork keeps the keys it inherits — config is whole-object across layers. A create merges in the route over the resolved org/yaml config (null removes the block, an empty result collapses to null); an update hands the adapter the block plus the inherited config and the merge happens inside the upsert. ([validated by keeps the resolved config's other keys while replacing pod_resources](apps/lore-api/src/features/agents/agents-schema.test.ts#L140), [validated by null removes pod_resources and an empty result collapses to null](apps/lore-api/src/features/agents/agents-schema.test.ts#L155), [validated by null existing config plus pod_resources yields just the block](apps/lore-api/src/features/agents/agents-schema.test.ts#L162), [validated by a create with pod_resources writes the block merged over the inherited config, never the block alone](apps/lore-api/src/api/routes/agent-definitions/agents-route.test.ts#L281), [validated by an update with pod_resources hands the adapter the block plus the inherited config to merge inside the upsert](apps/lore-api/src/api/routes/agent-definitions/agents-route.test.ts#L307))
  - The sync render honours the stored block on the rendered Station. *(amended 2026-09-02)* A stored override merges PER KEY onto the platform defaults instead of replacing the whole object: a memory-only override used to silently drop the ephemeral-storage defaults, Autopilot backfilled a bare 1Gi, and every tdd-round pod was evicted mid-install for a setting that only meant to raise memory. The price — a default cannot be unset, only overridden — is deliberate. ([validated by a full pod_resources override takes every key of both maps](libs/shared/src/project/agents/agent-crd.test.ts#L163), [a memory-only pod_resources override keeps the cpu and ephemeral-storage defaults](libs/shared/src/project/agents/agent-crd.test.ts#L193))

- **FR24 — Org-default definitions editable from the global /agents page.** The
  catalog every repo inherits is edited where it is listed: the global page
  links each definition to an org editor whose save upserts the org row
  (`project_id IS NULL`) — per-repo overrides stay on a repo's Agents tab.
  - `updateOrgDefinition` upserts the org row against the `project_id IS NULL` partial unique index and appends the `lore.catalog_events` row the cluster-agents' sync loops tail, in one statement. ([validated by upserts the org row (project_id NULL conflict target) and appends a catalog event in one statement](libs/shared/src/project/agents/agent-defs-pg.test.ts#L204))
  - `PUT /api/agent-definitions/{name}` (admin scope) writes the org default and returns it. ([validated by upserts the org-default row and returns the written definition](apps/lore-api/src/api/routes/agent-definitions/org-update.test.ts#L69))
  - The org write merges `pod_resources` inside the upsert, over the org row's own config — atomic under the row lock, so a concurrent edit is never read in one statement and lost in the next — with the yaml layer as the fallback for a row that has no config of its own; null removes the block and an emptied config collapses to NULL. A body that never mentions `pod_resources` keeps the row's config exactly as it was. The per-repo project row upsert merges the same way. ([validated by merges pod_resources inside the upsert: binds touched=true and the block, and merges over the row's own config in SQL](apps/lore-api/src/api/routes/agent-definitions/org-update.test.ts#L94), [validated by a PUT that never mentions pod_resources binds touched=false so the row's config is kept as is](apps/lore-api/src/api/routes/agent-definitions/org-update.test.ts#L122), [validated by without a pod_resources write binds touched=false and keeps the row's config in the conflict branch](libs/shared/src/project/agents/agent-defs-pg.test.ts#L231), [validated by with a pod_resources write merges the block over the row's own config in SQL, the inherited layer as fallback](libs/shared/src/project/agents/agent-defs-pg.test.ts#L254), [validated by a null pod_resources write removes the block: binds touched=true with no block so an emptied config collapses to NULL](libs/shared/src/project/agents/agent-defs-pg.test.ts#L285), [validated by binds touched, inherited config and block after the repo and merges in the project row's conflict branch](libs/shared/src/project/agents/agent-defs-pg.test.ts#L309))
  - A non-empty `image` is refused with `400 image_org_gated`: the two-key image ceremony is CODEOWNERS-scoped to a repo, and no repo is in hand on the org surface. ([validated by rejects a non-empty image with 400 — org image changes go through the per-repo two-key flow](apps/lore-api/src/api/routes/agent-definitions/org-update.test.ts#L140))
  - An invalid body is rejected `400 invalid_agent`. ([validated by rejects an invalid body with 400 invalid_agent](apps/lore-api/src/api/routes/agent-definitions/org-update.test.ts#L154))
  - The web-ui client PUTs the org resource and maps results like the repo writes, including the org image refusal and missing env. ([validated by PUTs the org-default resource and returns ok](apps/web-ui/src/lib/agents-api.test.ts#L203), [validated by maps a 400 image_org_gated response to an error message](apps/web-ui/src/lib/agents-api.test.ts#L220), [validated by returns unconfigured when env is missing](apps/web-ui/src/lib/agents-api.test.ts#L228))
  - The global list links each row to `/agents/edit/[name]` and says the save lands org-wide. ([validated by orgEditable links each row to the global org-default editor](apps/web-ui/src/app/repos/[owner]/[repo]/agents/AgentList.test.tsx#L180))
  - The org editor notes the org-wide effect and hides the image + approval inputs. ([validated by orgScope notes the org-wide save and hides the image + approval inputs](apps/web-ui/src/app/repos/[owner]/[repo]/agents/AgentForm.test.tsx#L184))

## Verification (manual / integration)

Migration 0015 applied to a throwaway Postgres confirmed the org seed (10 rows),
the `task_overrides` backfill, idempotency, and the project-over-org resolve
query (documented in the PR). Suites green: shared, mcp-server, floor, web-ui.
