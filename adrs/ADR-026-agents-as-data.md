---
adr_number: 26
title: "Agents as data: lore.agents table reached through project.agents; workflows stay in-repo"
status: accepted
date: 2026-06-16
domains: [agent, pipeline, web-ui, infra]
---

# ADR-026: Agents as data

## Context

Per-task-type behaviour — model, timeout, prompt, container image — was hardcoded
org-wide in `scripts/task-types.yaml` (baked into the claude-runner image at
`/config/task-types.yaml`) and only thinly overridable per repo via a JSONB blob,
`lore.repos.settings.task_overrides[type]`. The settings UI surfaced just
model / timeout / a prompt *suffix*, buried in one scrolling form. Operators
could not define or retune a repo's agents without a source edit and a redeploy.

We want agents to be **first-class, per-repo data** an operator edits from the UI
(and a developer edits from a skill), driving every task runner — while keeping
the offline/bootstrap fallback the runner pods rely on.

## Decision

Promote agent configuration to a table, **`lore.agents`**, reached only through
the Project facade port **`project.agents`**.

- **Schema.** `lore.agents(name, model, timeout_minutes, prompt, image,
  project_id, execution_mode, review_required, …)`. A row with `project_id = NULL`
  is the **organisation default**; a row with a `project_id` (→ `lore.repos.id`)
  is that repo's override. Partial unique indexes enforce one org default per
  name and one project override per `(name, repo)`. The agent is **pure config**:
  no `workflow` or `trigger` column (see below).

- **Resolution.** `resolveAgentConfig` field-merges three layers —
  project row → org row → `task-types.yaml` base. The yaml stays the **prompt
  base + offline fallback**, so seeded org rows carry only the tunable scalars
  (model/timeout/mode/review) and leave `prompt` to inherit the yaml.

- **One access path.** A new `AgentDefsPort` on the existing `project.agents`
  facade (alongside `run()`), with a three-way optional-port seam selected by
  environment: `PgAgentDefs` (DB present — floor, mcp-server), **`AgentDefsHttp`
  (Station pod / local stdio — the runner fetches its config over the API, same
  channel as context hydration)**, `AgentDefsYaml` (offline/bootstrap). No
  consumer reads `lore.agents` directly.

- **Runners fetch from the port.** The controller resolves only what k8s needs to
  *build* the pod (`image`, `timeout` → `activeDeadlineSeconds`); the runner
  fetches `model`/`prompt` (and any in-pod per-node config) from the agents API
  via `AgentDefsHttp`. The pod never reaches Postgres.

- **Authorization.** Writes are admin-scoped; the `image` field stays two-key
  gated (CODEOWNERS `dark-factory-approval` PR, reusing `verifyApproval`), like
  `dark_factory.execution.image` (ADR-025). `GET` is read-scoped so a runner's
  task token can resolve agents.

- **Workflows stay in the repo, not the DB.** An agent is many-to-many with
  workflows, so the mapping lives only in the workflow YAML's `agent` nodes
  (referenced by name). Workflows change rarely and want PR review, so they
  belong in `.lore/workflows/*.yaml` (built-in `libs/runner` workflows as the
  fallback). What *starts* a run (the ingress event) is a property of the
  workflow (`on:`), not the agent — deferred to a follow-up (Phase 2) with the
  dispatch registry.

## Consequences

- The Agents settings tab + `/lore-agents` skill edit agents live; no redeploy.
- `task-types.yaml` is no longer the single source for the tunable scalars, but
  remains the prompt base and the DB-down fallback.
- Org-wide default edits now flow through the DB (audited in `pipeline.audit_log`)
  rather than a reviewed source change; org-level editing UI is secondary.
- The existing `task_overrides` JSONB is migrated into project rows (0015) and
  left in place but no longer read.
- Phase 2 (separate): the `.lore/workflows/` loader and the workflow `on:`
  triggers + event-dispatch registry.
