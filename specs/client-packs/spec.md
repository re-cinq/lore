# Client packs: a client's own agents, prompts and assembly lines

| Feature | Client packs |
| ------- | ------------ |
| Branch  | main         |
| Status  | Draft        |
| Created | 2026-11-17   |
| Owner   | Bogdan       |

A client who installs Lore on their own Kubernetes cluster today cannot customise agent behaviour or add their own assembly lines without building a modified copy of the Lore image — or manually editing agents through the UI, which locks them out of improvements we ship to those agents in future releases. The pack solves this by letting clients configure a git repository of their own that Lore applies on top of what we ship.

## Problem Statement

A client who installs Lore on their own Kubernetes cluster today cannot customise agent behaviour or add their own assembly lines without building a modified copy of the Lore image — or manually editing agents through the UI, which locks them out of improvements we ship to those agents in future releases.

The pack solves this. A client configures the address of a git repository they own — their "pack" — in their Helm values. Lore reads that repository and applies it on top of what we ship: prompt extensions that add client-specific instructions while still receiving our future improvements; full prompt replacements where the client needs to diverge; new assembly lines the client defines from scratch; and removals that revert cleanly when a file is taken out of the pack.

Every change to the pack reaches the running install automatically — on a push to the pack repository, on a periodic catch-up, and whenever Lore restarts or is upgraded — without touching the cluster. A settings card shows the last commit applied and flags any files the sync refused. When no pack is configured, behaviour is exactly what it is today.

## Pack Configuration

- **FR-001**: A client configures the address of a git repository they own — their "pack" — in their Helm values.

## Pack Layout

## Agent Prompt Sources

- **FR-002**: Lore reads the pack repository and applies it on top of what we ship: prompt extensions that add client-specific instructions while still receiving our future improvements; full prompt replacements where the client needs to diverge; and removals that revert cleanly when a file is taken out of the pack.

## Automatic Sync

- **FR-003**: Every change to the pack reaches the running install automatically — on a push to the pack repository, on a periodic catch-up, and whenever Lore restarts or is upgraded — without touching the cluster.

## Apply Behavior

- **FR-004**: When no pack is configured, behaviour is exactly what it is today.

## Pack Pipelines

- **FR-005**: The pack supports new assembly lines the client defines from scratch.

## Pack Status Card

- **FR-006**: A settings card shows the last commit applied and flags any files the sync refused.

## Read-Only Enforcement

## Agent Author Identity

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

## Open Questions
