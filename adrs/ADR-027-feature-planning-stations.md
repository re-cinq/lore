---
adr_number: 27
title: "Smart feature planning: interactive Stations, a Feature port, and a graph-merged Feature node"
status: accepted
date: 2026-06-17
domains: [web-ui, agent, pipeline]
---

# ADR-027: Smart feature planning via Stations

> **Mechanism update ([ADR-031](./ADR-031-agent-station-crds.md)).** "Stations" survive as
> a first-class concept — they are now the ai-agent-subsystem `Station` CRs, not the
> `LoreTask` backend. Feature planning/finalize still run in-process for the lightweight
> path; the cluster path is the new substrate.

## Context

Spec authoring is the most context-dependent step in the Lore pipeline and the
least interactive. `feature-request`
([handle-feature-request.ts](../apps/floor/src/application/task-processing/handle-feature-request.ts))
runs one LLM pass and opens a PR — no human in the loop, no place for a draft,
and no way to steer the architecture before the PR exists. Features themselves
are not first-class: they are `specs/<n>-<name>/` folders *computed* into the
spec-trace graph by [featureDirOf](../libs/shared/src/spec-trace/feature-dir.ts)
in [flattenSpecGraph](../libs/shared/src/spec-trace/spec-graph.ts), with no
persistent row, no lifecycle, and nowhere for a half-formed idea to live.

`specs/7-feature-planning/` specifies an interactive alternative: a Features tab,
a smart feature page that runs an analysis assembly line, per-section refinement,
and a finalize step that opens a spec PR. Several cross-cutting decisions in that
design are worth recording because they diverge from the existing fire-and-forget
path.

## Decision

**Run planning and finalize as interactive Stations (Job pods), persist feature
lifecycle through a Project port, and make the persistent Feature node the source
of truth in the graph.**

- **Planning/finalize are Stations, decoupled from dark-factory.** `feature-planning`
  and `feature-finalize` are `claude-code` task types that always take the LoreTask
  CRD → Job pod path, regardless of the dark-factory cluster gate. The pod runs the
  workflow (graph-executor) via a task-type→workflow map in
  [job-builder.ts](../apps/floor/src/application/loretask-controller/job-builder.ts)
  that sets the workflow env unconditionally for these two types — so they are full
  Stations rather than raw `claude --print`. Rationale: the planning agent must clone
  the repo and reason over it, and finalize must commit a file; both are pod work.
- **The planning Station starts after clone + whole-timeline context.** The pod is
  passed `LORE_FEATURE_ID`/`LORE_FEATURE_ITERATION`; context hydration
  ([context.ts](../apps/mcp-server/src/api/routes/context.ts)) prepends the full
  feature timeline (prior rounds' results + per-section answers, read through
  `project.features`) ahead of the assembled project context, so each round builds
  on the last.
- **Result transport is a pod POST, not a commit.** A planning round produces
  structured data, not repo edits, so the Station POSTs its validated, sanitized
  `GapResult` to `POST /api/repos/:o/:r/features/:id/iterations/:n/result`
  (write-scope; egress already allowed by the pod NetworkPolicy, same channel as
  `/api/context`). Planning makes no commits → no PR. The watcher's no-changes Issue
  path is skipped for `feature-planning`. Finalize, by contrast, commits
  `specs/<slug>/spec.md` and the existing watcher opens the PR + conditional Issue.
- **Feature lifecycle is a Project port.** `lore.features` / `lore.feature_iterations`
  (the `lore` schema, owned by the migration runner) are reached only through a
  `features` port on the Project facade ([libs/shared/src/project/features/](../libs/shared/src/project/features/)),
  mirroring [task-store-pg.ts](../libs/shared/src/project/tasks/task-store-pg.ts).
  The draft spec stays uncommitted in `draft_spec_md` until the author finalizes;
  even then it ships as a PR, never a direct `main` commit.
- **The persistent Feature node replaces the computed one in the graph.** The
  `trace/graph` endpoint ([trace.ts](../apps/mcp-server/src/api/routes/trace.ts))
  merges `project.features.list(repo)` onto the computed Feature nodes joined by
  `(repo, path)`: a match is enriched (the persistent node wins, carrying status +
  id), and a draft with no spec yet is injected as a standalone node. The D3 view
  ([SpecGraphD3.tsx](../apps/web-ui/src/app/repos/[owner]/[repo]/graph/SpecGraphD3.tsx))
  colors Feature nodes by lifecycle status.
- **Generated mockups are untrusted.** `GapResult.mockups` carry LLM-generated SVG.
  Two layers defend it: (1) `sanitizeSvg()` strips script/foreignObject/handlers/
  external refs on every write path before persistence, and (2) the web UI
  ([MockupSection.tsx](../apps/web-ui/src/app/repos/[owner]/[repo]/features/[id]/MockupSection.tsx))
  re-sanitizes with **DOMPurify** (SVG profile) on the client and injects the result
  via `innerHTML` after mount — never through the unsanitized `rehype-raw` path used
  elsewhere. Mockups render **inline** (responsive, theme-aware, downloadable) rather
  than in a sandboxed iframe; the iframe's origin isolation is traded for DOMPurify's
  DOM-based sanitization. Residual risk (a DOMPurify bypass running in the page origin)
  should be further bounded by a page-level CSP — recommended follow-up.

## Consequences

- **feature-planning is a first-class agent definition.** Its prompt/model/timeout
  resolve through `lore.agent_definitions` via `project.agentDefs.resolve("feature-planning")`
  (project override → org default → yaml/code), like every other task type — not a
  hardcoded constant. The org-default row is seeded by migration `0018` (prompt populated
  from `PLANNING_INSTRUCTIONS`, idempotent + non-destructive so UI edits survive); the
  constant remains the offline/bootstrap fallback (the `AgentDefsYaml` layer serves it).
  Org admins edit the prompt org-wide in the `/agents` UI; per-repo overrides win.
  `runner-cli` (container) and `handle-feature-planning` (in-process) both resolve by name.
- A bad `0017` migration would wedge the UI deploy (`helm upgrade --wait`), so the
  migration is `lore`-schema, idempotent, single-transaction-safe, locally
  pre-flighted, and CI-guarded (spec FR-9).
- Planning cost is one pod + Sonnet call per round; a per-feature iteration soft-cap
  bounds runaway refinement.
- The graph merge couples the `trace/graph` route to `project.features`, but keeps
  the DB out of the Dgraph port (merge happens at the composition layer where both
  ports are available).
- `feature-planning`/`feature-finalize` must be added to `TRUST_LEVELS` or low-trust
  repos silently fail to create features.
