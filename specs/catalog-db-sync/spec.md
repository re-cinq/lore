# Feature Specification: DB-First Agent Catalog with Pull-Based Fan-Out

| Field   | Value                                          |
| ------- | ---------------------------------------------- |
| Feature | DB-First Agent Catalog with Pull-Based Fan-Out |
| Branch  | feat/catalog-db-seed-pull-sync                 |
| Status  | In Progress                                    |
| Created | 2026-09-01                                     |
| Owner   | Platform Engineering                           |

The AgentDefinition/Station CRD catalog the ai-agent-subsystem resolves at dispatch gets one source of truth — `lore.agent_definitions`, seeded by migration from `scripts/task-types.yaml` — and one delivery mechanism: an append-only change log every registered cluster-agent tails with its own cursor and applies to its own cluster, replacing both the Helm catalog-seed hook (which could only reach the chart's own cluster) and the single-target HTTP push from lore-api (which never reached a satellite at all).

## Problem Statement

Two mechanisms populated the catalog CRDs and neither reached every
cluster. The Helm `catalog-seed` pre-upgrade hook applied a committed,
chart-templated seed to whatever single cluster the umbrella deploy
targeted; a `/agents` UI save wrote Postgres and then pushed a CRD pair
to the one `CLUSTER_AGENT_URL`. Satellites got org defaults only if
their standalone chart carried its own seed, and per-repo overrides
never. Worse, override CRDs were named by bare task-type name, so two
repos overriding the same task type silently replaced each other's live
recipe in a shared cluster.

## FR1 — The change log

- FR1.1: Every `lore.agent_definitions` create, update and delete appends one row to the append-only `lore.catalog_events` log in the same SQL statement, so a definition can never exist without the event that fans it out. ([validated by create, update and delete each append a lore.catalog_events row in the same statement](../../libs/shared/src/project/agents/agent-defs-pg.test.ts#L181))
- FR1.2: The log is multi-reader and cursor-addressed: `listSince(cursor, limit)` returns only events past the cursor, ascending, capped at the batch limit. ([validated by listSince(2) returns only events with id greater than 2, in order](../../libs/shared/src/project/agents/catalog-events.test.ts#L31), [validated by listSince caps the batch at the given limit](../../libs/shared/src/project/agents/catalog-events.test.ts#L47), [validated by listSince binds the cursor and limit and maps project_id to projectId](../../libs/shared/src/project/agents/catalog-events.test.ts#L86))
- FR1.3: A snapshot read returns every current `(name, project_id)` definition together with the max event id at read time, cursor first, so an event appended mid-snapshot is re-applied by the first tail rather than skipped. ([validated by snapshot returns the current entries with the max event id as cursor](../../libs/shared/src/project/agents/catalog-events.test.ts#L59), [validated by snapshot reads the max event id BEFORE the definitions so a concurrent append re-applies instead of skipping](../../libs/shared/src/project/agents/catalog-events.test.ts#L104), [validated by snapshot on an empty log carries cursor 0](../../libs/shared/src/project/agents/catalog-events.test.ts#L78), [validated by snapshot of an empty log falls back to cursor 0](../../libs/shared/src/project/agents/catalog-events.test.ts#L126))

## FR2 — The per-agent cursor

- FR2.1: Each registered cluster-agent carries its own `catalog_cursor` high-water mark; a fresh registration starts at null, the never-resynced signal. ([validated by a fresh registration carries a null catalog cursor, the never-resynced signal](../../libs/shared/src/project/cluster-agents/cluster-agents.test.ts#L269))
- FR2.2: Cursor advancement is monotonic — an older ack can never move it backwards and replay the whole tail — and a null cursor is set even by an ack of zero, so an agent that applied an empty snapshot still lands in tail mode. ([validated by advanceCatalogCursor moves forward but never backwards](../../libs/shared/src/project/cluster-agents/cluster-agents.test.ts#L281), [validated by advanceCatalogCursor is monotonic on the DB side via GREATEST](../../libs/shared/src/project/cluster-agents/cluster-agents.test.ts#L375))

## FR3 — The catalog-events endpoint

`GET /api/cluster-agents/{id}/catalog-events` is the fan-out sibling of
claim: per-agent bearer auth, at-least-once delivery via an `ack`
query parameter rather than advance-on-read.

- FR3.1: The endpoint authenticates exactly as claim does — no bearer is 401, and a valid token presented against another agent's id is 403. ([validated by rejects 401 without a bearer token](../../apps/lore-api/src/api/routes/cluster-agents/catalog-events.test.ts#L48), [validated by rejects 403 when the token holder claims another agent's id](../../apps/lore-api/src/api/routes/cluster-agents/catalog-events.test.ts#L56), [validated by refuses a poll presenting another agent's token](../../apps/lore-api/src/integration-tests/catalog-events.test.ts#L208))
- FR3.2: A never-resynced agent is answered with the full current catalog (`mode: "snapshot"`), each entry carrying its resolved definition inline, plus the cursor to ack once everything is applied — the bootstrap that replaced the Helm seed hook's deploy-ordering guarantee. ([validated by a never-resynced agent gets the full snapshot with resolved definitions and the cursor to ack](../../apps/lore-api/src/api/routes/cluster-agents/catalog-events.test.ts#L64), [validated by a fresh agent's first poll is the full snapshot, including the 0054-seeded org defaults](../../apps/lore-api/src/integration-tests/catalog-events.test.ts#L123))
- FR3.3: The same tail is re-served until the agent's next call acks the cursor it finished applying; after the ack only newer events follow. A crash between read and apply therefore re-delivers instead of silently skipping. ([validated by the same tail is re-served until the agent acks it, then only newer events follow](../../apps/lore-api/src/api/routes/cluster-agents/catalog-events.test.ts#L90), [validated by an empty tail answers with the stored cursor and no entries](../../apps/lore-api/src/api/routes/cluster-agents/catalog-events.test.ts#L169), [validated by a write through the production adapter reaches an acked agent as one tail entry, and its served definition renders a qualified CRD pair](../../apps/lore-api/src/integration-tests/catalog-events.test.ts#L141))
- FR3.4: A deleted override resolves to a null definition — the delete-the-CRDs signal — and rapid saves of one entry collapse into a single resolved entry per response. ([validated by a deleted override resolves to a null definition, the delete-the-CRDs signal](../../apps/lore-api/src/api/routes/cluster-agents/catalog-events.test.ts#L132), [validated by rapid saves of one entry collapse into a single resolved entry per tail](../../apps/lore-api/src/api/routes/cluster-agents/catalog-events.test.ts#L152), [validated by deleting the override serves a null definition — the delete-the-CRDs signal](../../apps/lore-api/src/integration-tests/catalog-events.test.ts#L192))

## FR4 — The cluster-agent sync loop

- FR4.1: Each tick fetches the unapplied batch and lands every entry in this cluster — a resolved definition becomes an applied CRD pair, a null one deletes the pair under its qualified name — remembering the response cursor as the ack for the next call. ([validated by applies each resolved entry as a CRD pair and returns the cursor to ack](../../apps/cluster-agent/src/catalog/catalog-sync-loop.test.ts#L95), [validated by a null definition deletes the pair under the project-qualified name](../../apps/cluster-agent/src/catalog/catalog-sync-loop.test.ts#L122))
- FR4.2: A failed entry keeps the previous ack, so the whole batch is re-served next tick and the failed apply retried without bookkeeping; a 401 rotates the identity through re-registration rather than reading as an error. ([validated by a failed entry keeps the previous ack so the whole batch is re-served](../../apps/cluster-agent/src/catalog/catalog-sync-loop.test.ts#L212), [validated by a 401 is the unauthorized outcome, not an error](../../apps/cluster-agent/src/catalog/catalog-sync-loop.test.ts#L240))
- FR4.3: An empty batch is the only idle outcome — it backs off doubling to the cap while still advancing the ack, so an empty snapshot lands the agent in tail mode. ([validated by an empty batch is idle but still advances the ack so an empty snapshot lands in tail mode](../../apps/cluster-agent/src/catalog/catalog-sync-loop.test.ts#L199), [validated by only consecutive empties back off, doubling to the cap](../../apps/cluster-agent/src/catalog/catalog-sync-loop.test.ts#L252), [validated by reads LORE_CLUSTER_AGENT_CATALOG_SYNC_INTERVAL_S with a 30s default](../../apps/cluster-agent/src/catalog/catalog-sync-loop.test.ts#L262))
- FR4.4: The loop signals its first successful sync exactly once — the gate the claim loop's start awaits, bounded by a timeout so a wedged API cannot keep a cluster from ever claiming — and threads the ack between ticks. ([validated by signals the first successful sync once, threads the ack between ticks, and rotates on 401](../../apps/cluster-agent/src/catalog/catalog-sync-loop.test.ts#L271))
- FR4.5: The per-cluster values the chart used to template into the committed seed ride the sync loop's environment instead; every unset value omits the block it feeds. ([validated by maps each set env var and omits every unset one](../../apps/cluster-agent/src/catalog/catalog-sync-loop.test.ts#L70))
- FR4.6: While the Helm catalog-seed hook still runs, the loop skips CRs the seed labeled rather than fighting its force-apply; flipping `LORE_CATALOG_SYNC_OWN_SEEDED` at cutover takes them over. ([validated by skips a seed-owned CR until ownSeeded is flipped, then applies over it](../../apps/cluster-agent/src/catalog/catalog-sync-loop.test.ts#L151))

## FR5 — The CRD builder

One mapping from a resolved row to the CRD pair, successor to both the
seed generator and lore-api's push mirror
(`libs/shared/src/project/agents/agent-crd.ts`).

- FR5.1: An LLM recipe renders with the full seed parity — LLM secret, git identity env, MCP entry, skills appended after `lore-context`, the pipeline-tool deny with recipe denies after, the telemetry sink, and the output watch — when every per-cluster value is set. ([validated by renders the full recipe when every per-cluster value is set](../../libs/shared/src/project/agents/agent-crd.test.ts#L50), [validated by config skills append after lore-context without duplicating it](../../libs/shared/src/project/agents/agent-crd.test.ts#L115), [validated by config disallowed_tools append after the pipeline deny and watch rides output](../../libs/shared/src/project/agents/agent-crd.test.ts#L127))
- FR5.2: A satellite's empty options omit the MCP block, the skills block, the LLM secret, the http sink and the `{context}` placeholder together — a recipe must never point at a URL its pod cannot reach. ([validated by a satellite's empty options omit the mcp/skills/secret blocks, the http sink AND the {context} placeholder](../../libs/shared/src/project/agents/agent-crd.test.ts#L103))
- FR5.3: A station-mode row renders the exec-vendor shape on the cluster's lore-station image with the ingest token, the LLM secret only where `needs_model` says so, its dgraph env repointable per cluster, and a command fallback derived from the def-stripped name. ([validated by renders the exec-vendor shape on the lore-station image with the ingest token](../../libs/shared/src/project/agents/agent-crd.test.ts#L194), [validated by a needs_model station additionally carries the cluster's LLM secret](../../libs/shared/src/project/agents/agent-crd.test.ts#L223), [validated by the dgraphUrl option repoints a config LORE_DGRAPH_HTTP entry](../../libs/shared/src/project/agents/agent-crd.test.ts#L236), [validated by a station row without a command falls back to lore-station plus the def-stripped name](../../libs/shared/src/project/agents/agent-crd.test.ts#L248))
- FR5.4: A read-only recipe (`repo_workdir: false`) omits the working directory, and a promptless LLM recipe is rejected before it can reach an apply. ([validated by repo_workdir false omits workingDir for read-only recipes](../../libs/shared/src/project/agents/agent-crd.test.ts#L147), [validated by a promptless recipe is rejected before it can reach an apply](../../libs/shared/src/project/agents/agent-crd.test.ts#L160))

## FR6 — Qualified names end the override collision

Two repos overriding the same task type used to collide on one
cluster-wide CR name; the last save silently replaced the other repo's
live recipe.

- FR6.1: An org default keeps the bare CR name; a per-repo override folds the project id into it, and both CRs of the pair plus the `agentDefRef` between them carry the qualified spelling. ([validated by an org default keeps the bare name](../../libs/shared/src/project/agents/agent-crd.test.ts#L38), [validated by a per-repo override folds the first 8 project-id hex chars into the name](../../libs/shared/src/project/agents/agent-crd.test.ts#L42), [validated by a per-repo override renders both CRs under the qualified name](../../libs/shared/src/project/agents/agent-crd.test.ts#L166))
- FR6.2: The Floor's dispatch points each visit's `stationRef` at the spelling the sync applied — qualified when the repo holds an override row, bare otherwise — resolved at enqueue time through the one spec builder every door shares.

## FR7 — Usage visibility

The catalog is the roster and the blueprints are one consumer of it, so
"is this definition used?" was answerable only by grep. The `/agents`
page now shows, per definition, exactly where it is dispatched from.

- FR7.1: A pure walk over the blueprint graphs maps every station a node resolves to — inherited agent nodes to their line's name, explicit `station_ref`s to their own name, non-agent pod nodes to `def-<type>`, human nodes skipped — and a blueprint-less task type like runbook is deliberately absent, which is why usage alone cannot define the roster. ([validated by maps inherited agent nodes to the line name, explicit station_refs to their own name, and station nodes to def-<type>](../../libs/assembly-lines/src/station-usage.test.ts#L57), [validated by the builtin catalog references implementation and def-validate but never runbook](../../libs/assembly-lines/src/station-usage.test.ts#L73))
- FR7.2: `GET /api/agent-definitions/usage` publishes the walk as a stable, name-sorted wire shape built from the builtin blueprints baked into the image. ([validated by maps the walk's refs to snake_case wire entries sorted by name](../../apps/lore-api/src/api/routes/agent-definitions/usage.test.ts#L9), [validated by the builtin catalog's response names implementation but never runbook](../../apps/lore-api/src/api/routes/agent-definitions/usage.test.ts#L47))
- FR7.3: The repo `/agents` list renders each definition's references, telling the three unreferenced shapes apart: blueprint nodes when they exist, "runs as a single agent" for a blueprint-less LLM/ingest task type, and a dormant flag only for a station-mode definition nothing references. ([validated by shows the blueprint nodes that use a definition, marking explicit station_refs](apps/web-ui/src/app/repos/[owner]/[repo]/agents/AgentList.test.tsx#L68), [validated by an unreferenced claude-code definition reads as a single-agent task type, not dormant](apps/web-ui/src/app/repos/[owner]/[repo]/agents/AgentList.test.tsx#L89), [validated by an unreferenced station-mode definition is flagged as not referenced by any assembly line](apps/web-ui/src/app/repos/[owner]/[repo]/agents/AgentList.test.tsx#L99), [validated by renders one table row per definition under the Name/Scope/Model/Timeout/Mode/Used by columns](apps/web-ui/src/app/repos/[owner]/[repo]/agents/AgentList.test.tsx#L22), [validated by null usage (endpoint unreachable) renders a dash, never an unreferenced claim](apps/web-ui/src/app/repos/[owner]/[repo]/agents/AgentList.test.tsx#L114), [validated by the Mode cell shows the deduped line names for a referenced claude-code recipe, single agent for a blueprint-less one, and the raw mode when usage is unknown](apps/web-ui/src/app/repos/[owner]/[repo]/agents/AgentList.test.tsx#L122), [validated by the Mode cell keeps the station tag even when lines reference the station](apps/web-ui/src/app/repos/[owner]/[repo]/agents/AgentList.test.tsx#L170))

- FR7.4: The global `/agents` page renders the org-default catalog — org rows overlaid on the yaml fallback via `GET /api/agent-definitions`, no per-repo layer — as the same table in read-only form: no Edit column, since editing is a per-repo act. ([validated by lists the org-default catalog with no project layer applied](../../apps/lore-api/src/api/routes/agent-definitions/org-list.test.ts#L37), [validated by answers 503 without a database](../../apps/lore-api/src/api/routes/agent-definitions/org-list.test.ts#L72), [validated by a null base renders the read-only org catalog — no Edit column, org-default hint](apps/web-ui/src/app/repos/[owner]/[repo]/agents/AgentList.test.tsx#L160))

## Retired mechanisms

The Helm `catalog-seed` hook, the committed `catalog-seed.yaml`, the
`gen-catalog` CLI, `check-catalog-drift.sh` and lore-api's synchronous
CRD push (`applyCatalogCrd`/`agent-crd-k8s.ts` catalog functions) are
retired once the pull path is verified in production — sequencing and
the dual-writer transition guard live in the plan and FR4.6.
`scripts/task-types.yaml` remains as the bottom-precedence resolve
fallback only.
