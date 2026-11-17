# Client packs: a client's own agents, prompts and assembly lines

| Feature | Client packs |
| ------- | ------------ |
| Branch  | main         |
| Status  | In Progress  |
| Created | 2026-11-17   |
| Owner   | Bogdan       |

A client who installs Lore on their own Kubernetes cluster today cannot customise agent behaviour or add their own assembly lines without building a modified copy of the Lore image — or manually editing agents through the UI, which locks them out of improvements we ship to those agents in future releases. The pack solves this by letting clients configure a git repository of their own that Lore applies on top of what we ship.

## Problem Statement

A client who installs Lore on their own Kubernetes cluster today cannot customise agent behaviour or add their own assembly lines without building a modified copy of the Lore image — or manually editing agents through the UI, which locks them out of improvements we ship to those agents in future releases. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/eccd0780-db5e-4dc4-be8a-5d7f059b1197#intent-p-1))

The pack solves this. A client configures the address of a git repository they own — their "pack" — in their Helm values. Lore reads that repository and applies it on top of what we ship: prompt extensions that add client-specific instructions while still receiving our future improvements; full prompt replacements where the client needs to diverge; new assembly lines the client defines from scratch; and removals that revert cleanly when a file is taken out of the pack. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/eccd0780-db5e-4dc4-be8a-5d7f059b1197#intent-p-2))

Every change to the pack reaches the running install automatically — on a push to the pack repository, on a periodic catch-up, and whenever Lore restarts or is upgraded — without touching the cluster. A settings card shows the last commit applied and flags any files the sync refused. When no pack is configured, behaviour is exactly what it is today. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/eccd0780-db5e-4dc4-be8a-5d7f059b1197#intent-p-3))

## Pack Configuration

- **FR-001**: A client configures the address of a git repository they own — their "pack" — via `LORE_PACK_REPO` and `LORE_PACK_REF` Helm values (`deploy/chart/charts/lore-api-helm/`, not on main); the repository may be on any git host Lore already integrates with, including GitHub Enterprise. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/eccd0780-db5e-4dc4-be8a-5d7f059b1197#scope-p-2))

## Pack Layout

- **FR-007**: The pack organises its content one folder per pipeline, identified by the pipeline's name; each folder may hold a full pipeline definition, agent prompt files for the agents the pipeline uses, and extension files that append text to the shipped prompts. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/eccd0780-db5e-4dc4-be8a-5d7f059b1197#scope-p-3))

- **FR-010**: Install documentation MUST ship with the feature: a pack layout reference describing the directory structure a pack repo must follow, and a custom stations service example. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/eccd0780-db5e-4dc4-be8a-5d7f059b1197#delivery-p-8))
- **FR-011**: A pack linter command MUST be provided at client handover; the client runs it in their pack repo's CI to catch invalid files before merge, using the same validation logic as Lore's own checks. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/eccd0780-db5e-4dc4-be8a-5d7f059b1197#delivery-p-9), [from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/eccd0780-db5e-4dc4-be8a-5d7f059b1197#custom-risks-p-5))

## Agent Prompt Sources

- **FR-002**: Lore reads the pack repository and applies it on top of what we ship. The pack supports three kinds of agent file: a new agent defined entirely in the pack; a full replacement of a shipped agent's prompt; and an additive extension that appends to the shipped prompt while still receiving future improvements. Removals revert cleanly when a file is taken out of the pack. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/eccd0780-db5e-4dc4-be8a-5d7f059b1197#scope-p-4))

- Full prompt replacement is the escape hatch for clients who must diverge entirely from a shipped agent; a client using full replacement will not receive future improvements to that agent's shipped prompt. The additive extension is the preferred path for client customisation. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/eccd0780-db5e-4dc4-be8a-5d7f059b1197#custom-risks-p-2))
- A prompt extension may contradict the shipped prompt; this is by design. The client owns the resulting behaviour and is responsible for testing it; Lore performs no automated consistency check between the extension and the shipped prompt. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/eccd0780-db5e-4dc4-be8a-5d7f059b1197#custom-risks-p-3))

## Automatic Sync

- **FR-003**: Every change to the pack reaches the running install automatically — at boot (`seedFloor` in `apps/lore-api/src/app/seed-floor.ts`, not on main, calls `applyPack` after `seedFloorPipelines` returns and before the HTTP server starts listening when `LORE_PACK_REPO` is set), on a push to the pack repository (a new `github.push` handler in `apps/stations/src/events/`, not on main, following the pattern in `apps/stations/src/events/floor-review-handlers.ts`), and on a scheduled catch-up tick (`cron.pack_sync.tick` added to `libs/shared/src/work/scheduler/`, not on main, with a sweep in `apps/stations/src/work/`) — without touching the cluster or performing a manual restart. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/eccd0780-db5e-4dc4-be8a-5d7f059b1197#scope-p-5), [from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/eccd0780-db5e-4dc4-be8a-5d7f059b1197#delivery-p-2), [from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/eccd0780-db5e-4dc4-be8a-5d7f059b1197#p_3e7d4628-b73f-42f2-8314-17d84dc82b9f))

## Apply Behavior

- **FR-004**: When no pack is configured, behaviour is exactly what it is today.

- **FR-008**: Applies are idempotent: only files whose content has changed since the last apply produce new agent or pipeline versions. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/eccd0780-db5e-4dc4-be8a-5d7f059b1197#scope-p-6))
- **FR-009**: Applies are removal-aware: removing an extension file from the pack reverts the affected agent to the shipped prompt; removing a client pipeline archives it on the Floor; runs already in progress finish on the version they started. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/eccd0780-db5e-4dc4-be8a-5d7f059b1197#scope-p-6))

- **FR-012**: The work is sequenced so each incremental delivery leaves the system in a working state. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/eccd0780-db5e-4dc4-be8a-5d7f059b1197#delivery-p-1))
- **FR-013**: Pack boot (FR-001) and agent author identity migration MUST ship together: the prompt migration must accompany the first pack boot to avoid rewriting the author identity into prompts. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/eccd0780-db5e-4dc4-be8a-5d7f059b1197#delivery-p-10))
- **FR-015**: Pack pipeline support (FR-005) and pipeline removal MUST ship together: pipeline support without removal leaves orphaned definitions on the Floor. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/eccd0780-db5e-4dc4-be8a-5d7f059b1197#delivery-p-10))

- **FR-018**: If the pack repository is unreachable at sync time, Lore MUST keep what the Floor already holds and record the error in `pack.sync`; an unreachable pack is never treated as an empty pack, so a transient outage does not archive client pipelines. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/eccd0780-db5e-4dc4-be8a-5d7f059b1197#custom-risks-p-4))

## Pack Pipelines

- **FR-005**: The pack supports new assembly lines the client defines from scratch; a folder in the pack defines a full pipeline alongside shipped files in `libs/assembly-lines/src/floor-pipelines/` (pack pipeline files live in the pack repo); a name collision between a pack folder and a shipped pipeline definition or another pack folder is refused. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/eccd0780-db5e-4dc4-be8a-5d7f059b1197#delivery-p-4))

- **FR-013**: Pipelines that need client-owned logic use a separately deployed stations service built on the published station contract; Lore itself runs no client code. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/eccd0780-db5e-4dc4-be8a-5d7f059b1197#scope-p-12))
- **FR-014**: The pack documentation covers pack layout and includes an example of a custom stations service for pipelines that need client-owned code. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/eccd0780-db5e-4dc4-be8a-5d7f059b1197#scope-p-10))

- **FR-007**: A client pipeline folder removed from the pack is archived on the Floor via an archive operation on `libs/shared/src/outbound/floor/floor-client.ts`; it is not deleted. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/eccd0780-db5e-4dc4-be8a-5d7f059b1197#delivery-p-5))

## Pack Status Card

- **FR-006**: A read-only Pack status card on the Settings page (`apps/web-ui/src/app/settings/`, not on main) shows the connected repository and branch, the last commit applied and when, counts of what the pack supplies (agents, pipelines, extensions), and any files the last sync refused; a "Sync now" action on the card triggers an immediate pack apply (access control subject to Q1); the data is served from the `pack.sync` key in `lore.settings` (`apps/lore-api/src/transport/routes/repos/org-settings.ts#L93`, not on main). ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/eccd0780-db5e-4dc4-be8a-5d7f059b1197#scope-p-8), [from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/eccd0780-db5e-4dc4-be8a-5d7f059b1197#delivery-p-6))

## Read-Only Enforcement

- **FR-010**: Agents the pack supplies become read-only org defaults: write routes for agent definitions (`apps/lore-api/src/transport/routes/agent-definitions/`, not on main) refuse requests that target pack-managed agents. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/eccd0780-db5e-4dc4-be8a-5d7f059b1197#scope-p-7))
- **FR-011**: The Edit action does not appear for pack-managed agents in the per-repository Agents tab (`apps/web-ui/src/app/repos/[owner]/[repo]/agents/`) or the global agents catalog (`apps/web-ui/src/app/agents/`), both not on main; per-repository agent variants remain editable. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/eccd0780-db5e-4dc4-be8a-5d7f059b1197#scope-p-7))

- **FR-008**: Pack-managed agent org defaults are read-only: write routes in `apps/lore-api/src/transport/routes/agent-definitions/` MUST refuse updates to pack-managed agents. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/eccd0780-db5e-4dc4-be8a-5d7f059b1197#delivery-p-6))
- **FR-016**: The Edit link MUST NOT appear for pack-managed agents in `apps/web-ui/src/app/repos/[owner]/[repo]/agents/` or the global agents catalog at `apps/web-ui/src/app/agents/`. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/eccd0780-db5e-4dc4-be8a-5d7f059b1197#delivery-p-6))

## Agent Author Identity

- **FR-012**: The commit author identity used by agents, currently embedded in `libs/shared/src/agent-defaults/*.md` as `${LORE_*}` placeholders, moves to Helm values (`LORE_COMMIT_AUTHOR_NAME`, `LORE_COMMIT_AUTHOR_EMAIL` or similar, not on main) so each client can configure their own. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/eccd0780-db5e-4dc4-be8a-5d7f059b1197#scope-p-9)) ([validated by gives every delivering recipe the commit author through config.env and no git identity line in its prompt @dfa8dea8](../../libs/shared/src/outbound/project/agents/agent-defaults-content.test.ts#L45))

- **FR-009**: The commit author name and email used by Lore's agents MUST move from the shipped prompt files in `libs/shared/src/agent-defaults/*.md` to Helm values (`LORE_COMMIT_AUTHOR_NAME` and `LORE_COMMIT_AUTHOR_EMAIL`, not on main). ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/eccd0780-db5e-4dc4-be8a-5d7f059b1197#delivery-p-7)) ([validated by gives every delivering recipe the commit author through config.env and no git identity line in its prompt @dfa8dea8](../../libs/shared/src/outbound/project/agents/agent-defaults-content.test.ts#L45))
- **FR-017**: A migration in `deploy/chart/charts/ui-helm/migrations/` MUST handle clusters that already hold prompts with the author identity embedded. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/eccd0780-db5e-4dc4-be8a-5d7f059b1197#delivery-p-7)) ([validated by writes the shipped prompt and env of the six agents that commit, and nothing else @1183fc89](../../apps/lore-api/src/work/floor/floor-migrations.test.ts#L266)) ([validated by names floor/0001 to floor/0013, whose every prompt, timeout, skills list and env comes from a shipped agent file @79678006](../../apps/lore-api/src/work/floor/floor-migrations.test.ts#L110))

## Sketches

Pack feature: new and changed components
```mermaid
flowchart LR
  helm["Helm chart"] -->|"LORE_PACK_REPO / LORE_PACK_REF"| loreApi["lore-api"]
  packRepo["pack repo (GitHub)"] -->|"github.push"| loreApi
  loreApi -->|"GitHub API fetch"| packRepo
  tick["scheduled tick"] --> loreApi
  loreApi --> packLoader["pack loader"]
  packLoader -->|"importPipeline"| floor["Floor"]
  packLoader -->|"write sync state"| loreSettings["lore.settings"]
  classDef new fill:#e7f5ec,stroke:#1f7a3f,stroke-width:2px,color:#0b3d1f
  classDef changed fill:#fff4e0,stroke:#b26a00,stroke-width:2px,color:#4a2c00
  class packLoader,packRepo,tick new
  class helm,loreApi,floor,loreSettings,settingsUi changed
```

Pack sync: push-triggered and boot-time apply
```mermaid
sequenceDiagram
  participant github as GitHub
  participant api as lore-api
  participant loader as pack loader
  participant floor as Floor
  participant db as lore.settings
  Note over github,api: same path runs at boot with LORE_PACK_REPO set
  github->>api: github.push to pack repo
  api->>github: fetch pack at commit
  alt pack repo unreachable
    api->>db: record error, keep existing state
  else pack fetched
    api->>loader: build overlay
    loader->>floor: importPipeline for each changed file
    loader->>floor: apply agent definitions
    loader->>db: write sync state (commit, counts, refused)
  end
```

New keys in lore.settings for pack config and sync state
```mermaid
erDiagram
  lore_settings {
    text key PK
    text value
    timestamptz updated_at
  }
  pack_sync_value {
    text commit "new"
    timestamptz applied_at "new"
    int agent_count "new"
    int line_count "new"
    int extra_count "new"
    text_array refused_files "new"
  }
  lore_settings ||--o| pack_sync_value : "key pack.sync"
```

Agent prompt source states: shipped, extended, replaced, pack-new
```mermaid
stateDiagram-v2
  state "pack-new" as packNew
  [*] --> shipped : seeded at first boot
  [*] --> packNew : new agent in pack
  shipped --> extended : pack adds extra file
  shipped --> replaced : pack adds full prompt
  extended --> shipped : pack removes extra file
  replaced --> shipped : pack removes full prompt
  packNew --> [*] : pack removes agent
  note right of extended : shipped prompt plus the extra appended
  note right of replaced : client prompt only
```

Pack status card on the Settings page
[Pack status card on the Settings page](sketches/m-ui-1.html)

## Success Criteria

- A client can customise agent behaviour and add assembly lines without building a modified copy of the Lore image. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/eccd0780-db5e-4dc4-be8a-5d7f059b1197#k-pack-image-unchanged))
- A pack reaches the running install and is applied without touching the cluster. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/eccd0780-db5e-4dc4-be8a-5d7f059b1197#k-push-to-applied))
- Pack prompt extensions append to shipped prompts without replacing them, so the client's install continues to receive Lore's future improvements to those agents. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/eccd0780-db5e-4dc4-be8a-5d7f059b1197#k-upgrade-extra-recompose))
- A malformed or invalid file in the pack is refused and recorded without halting the install. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/eccd0780-db5e-4dc4-be8a-5d7f059b1197#k-bad-file-no-halt))

- **SC-001**: Acceptance is confirmed by an internal cluster test with a scratch pack repo containing a prompt extension on a shipped pipeline and one new pipeline folder: (1) the extended agent's prompt body, readable via the agent-definitions route in `apps/lore-api/src/transport/routes/agent-definitions/`, includes the extension text appended after the shipped prompt; (2) the new pipeline name appears in Floor's pipeline list (verifiable via `importPipeline` in `libs/shared/src/outbound/floor/floor-client.ts`); (3) the `commit` field in the `pack.sync` JSON value stored in `lore.settings` (FR-C-004) equals the scratch pack's HEAD commit SHA and `applied_at` is non-null; and (4) the write route for that agent's org default at `apps/lore-api/src/transport/routes/agent-definitions/` returns HTTP 4xx (FR-010). ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/eccd0780-db5e-4dc4-be8a-5d7f059b1197#delivery-p-11))

## Open Questions

- **Q1 — Sync now access**: Is the "Sync now" action restricted to org admins, or available to all users who can reach the settings page? ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/eccd0780-db5e-4dc4-be8a-5d7f059b1197#q-sync-now-access))
- **Q2 — Pack repository host**: Is the pack repository assumed to always be on GitHub, or must the design support other hosts (GitLab, self-hosted) from the start? ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/eccd0780-db5e-4dc4-be8a-5d7f059b1197#q-github-only))

- **OQ-1**: When re-applying a pack agent that already has per-repository variants, should the apply merge (preserve per-repo variants) or replace (overwrite the whole agent)? ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/eccd0780-db5e-4dc4-be8a-5d7f059b1197#q-reapply-merge-or-replace))

- Who is the technical owner for this feature? Bogdan to name. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/eccd0780-db5e-4dc4-be8a-5d7f059b1197#q-technical-owner))

- **Q-001**: How often should the scheduled catch-up tick (`cron.pack_sync.tick`) run? ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/eccd0780-db5e-4dc4-be8a-5d7f059b1197#q-tick-frequency))

## Out of Scope

- New integrations are added to Lore itself through separate plans, not via packs. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/eccd0780-db5e-4dc4-be8a-5d7f059b1197#scope-p-13))
- A pack can extend a shipped pipeline's agent prompts but cannot replace the pipeline's shape; Lore's own behaviour depends on those shapes. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/eccd0780-db5e-4dc4-be8a-5d7f059b1197#scope-p-14))
- One pack per installation is supported; multiple packs or one pack per team are not. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/eccd0780-db5e-4dc4-be8a-5d7f059b1197#scope-p-15))

## Constraints

- **FR-C-001**: The overlay — the step that combines what Lore ships with what the pack supplies to produce the effective set of agents and pipelines — MUST be computed without touching the Floor; the pack loader MUST follow the `SeedDeps` port pattern (`files()`, `heldAgentDefinitions()`, `importPipeline()`) declared in `apps/lore-api/src/work/floor/seed-floor-pipelines.ts`, so overlay logic can be exercised in tests without a running cluster. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/eccd0780-db5e-4dc4-be8a-5d7f059b1197#constraints-p-1))
- **FR-C-002**: Agents the pack does not name MUST keep today's behavior: seeded at first boot and updated through Lore's standard migration path. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/eccd0780-db5e-4dc4-be8a-5d7f059b1197#constraints-p-2))
- **FR-C-003**: Environment values MUST NOT be substituted into prompts; they MUST be substituted only into agent settings via `withEnvironment` (`apps/lore-api/src/work/floor/seed-floor-pipelines.ts`), which fills `${LORE_*}` env vars in settings and never in prompt bodies. The commit author identity MUST be removed from the shipped prompt files (`libs/shared/src/agent-defaults/*.md`) and moved to per-install Helm configuration; this feature adds `LORE_COMMIT_AUTHOR_NAME` and `LORE_COMMIT_AUTHOR_EMAIL` to the Helm chart (`deploy/chart/charts/lore-api/`) for this purpose, with a migration for clusters that already hold the existing prompts. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/eccd0780-db5e-4dc4-be8a-5d7f059b1197#constraints-p-3)) ([validated by gives agent loop-dod the commit author through config.env and no git identity line in its prompt @584c7b7b](../../apps/lore-api/src/work/floor/seed-floor-pipelines.test.ts#L309)) ([validated by adds the shipped env with the environment filled in to the org default's env and keeps the env it already has @425a1c40](../../apps/lore-api/src/work/floor/floor-migrations.test.ts#L384)) ([validated by throws naming the variable when the environment lacks one the shipped env names @ff749dda](../../apps/lore-api/src/work/floor/floor-migrations.test.ts#L411)) ([validated by throws for a shipped file with no env @3e4b024e](../../apps/lore-api/src/work/floor/floor-migrations.test.ts#L424))
- **FR-C-004**: Sync state (last commit applied, refused files, counts) MUST be stored once in `lore.settings` under the `pack.sync` key — shaped by the model in `libs/shared/src/domain/models/` and returned by the `SELECT key, value, updated_at FROM lore.settings` query in `apps/lore-api/src/transport/routes/repos/org-settings.ts` — and shared across all Lore replicas, so the settings page is consistent regardless of which replica serves the request. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/eccd0780-db5e-4dc4-be8a-5d7f059b1197#constraints-p-4)) ([validated by returns the pack.sync state parsed beside the settings rows @917b69fb](../../apps/lore-api/src/transport/routes/repos/org-settings.test.ts#L68)) ([validated by accepts the state a successful sync stores @cbf42258](../../libs/shared/src/domain/models/pack-sync-state.test.ts#L25)) ([validated by accepts the state of a first sync that failed, with no commit applied yet @1c81ba05](../../libs/shared/src/domain/models/pack-sync-state.test.ts#L29)) ([validated by refuses a state with a negative agent count @3065f833](../../libs/shared/src/domain/models/pack-sync-state.test.ts#L48)) ([validated by returns null when the setting is unset @0fabc872](../../libs/shared/src/outbound/project/settings/pack-sync-store.test.ts#L21)) ([validated by returns the state stored as JSON text @9714d603](../../libs/shared/src/outbound/project/settings/pack-sync-store.test.ts#L25)) ([validated by throws naming pack.sync when the stored text is not a state @b9bd7eb7](../../libs/shared/src/outbound/project/settings/pack-sync-store.test.ts#L29))
- **FR-C-005**: Lore MUST read the pack through the same git host integration it already uses (`apps/lore-api/src/outbound/github-client.ts`; single-host config via `libs/shared/src/domain/github-host.ts` and `GITHUB_HOST`). That integration must be installed on the pack repository before Lore can sync it; the same host support Lore already offers — including GitHub Enterprise — applies to the pack. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/eccd0780-db5e-4dc4-be8a-5d7f059b1197#constraints-p-5))
- **FR-C-006**: An apply triggered by an incoming webhook MUST be idempotent and safe to run more than once; when multiple Lore replicas receive the same push event simultaneously, the apply MUST acquire a `DbLeaseBackend` lease (`libs/shared/src/outbound/project/leases/lease-backends.ts`) so only one replica proceeds. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/eccd0780-db5e-4dc4-be8a-5d7f059b1197#constraints-p-6))
- **FR-C-007**: When applying a pack agent that already has per-repository variants, the apply MUST preserve those variants: the org default for that agent is updated from the pack, but existing per-repository customisations are merged rather than replaced, using `withVariant` in `libs/shared/src/outbound/project/agents/agent-defs-floor.ts` and the resolution chain in `libs/shared/src/outbound/project/agents/agent-defs-port.ts`. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/eccd0780-db5e-4dc4-be8a-5d7f059b1197#p_864ae530-b83a-44c0-a252-e335f77a2803), [from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/eccd0780-db5e-4dc4-be8a-5d7f059b1197#custom-risks-p-1))

## Ownership

- The Lore platform team owns changes to Lore itself. The technical owner for this feature is to be named by Bogdan. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/eccd0780-db5e-4dc4-be8a-5d7f059b1197#ownership-p-1))
- re-cinq writes and maintains the first client's pack. The client takes it over after handover is complete. ([from plan](https://lore.gcp.re-cinq.com/repos/re-cinq/lore/plans/eccd0780-db5e-4dc4-be8a-5d7f059b1197#ownership-p-2))
