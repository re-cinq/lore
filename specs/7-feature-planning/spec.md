# Feature Specification: Smart Feature Planning

| Field          | Value                                       |
|----------------|---------------------------------------------|
| Feature        | Smart Feature Planning                      |
| Branch         | 7-feature-planning                          |
| Status         | In Progress                                 |
| Created        | 2026-06-17                                  |
| Owner          | Platform Engineering                        |

## Problem Statement

Lore can already turn a one-line intent into a spec PR through the
`feature-request` task type, but it is fire-and-forget: a single LLM pass
commits `spec.md`/`data-model.md`/`tasks.md` and opens a PR with no human in
the loop and nowhere for a half-formed idea to live. A product owner cannot
shape the spec interactively, cannot see the gaps the model identified, and
cannot steer the architecture before the PR exists. There is also no
first-class, persistent **Feature** entity: features exist only implicitly as
`specs/<n>-<name>/` folders, computed into the spec-trace graph after the fact.
A draft feature — one being thought through but not yet committed — has no home.

The result: the spec authoring that should be the most collaborative,
context-aware step in the pipeline is the least interactive one.

## Vision

A repo page has a **Features** tab listing every feature — drafts in progress
and shipped — as a browsable list with a detail view. A **"+ Feature"** button
opens a **smart feature page**: the author writes a prompt describing what they
want. On submit, an **assembly line of Stations** (ephemeral Job pods) clones
the repo, assembles the *whole feature timeline plus project* context, and an
agent produces a **gap-closing analysis**: architecture details, user flows,
generated visual mockups, follow-up questions, and an invitation for free-form
direction. The author reviews each section, leaves **per-section comments and
direction**, and either refines (another Station round) or **finalizes**.

Finalize writes `specs/<slug>/spec.md`, commits it to a branch, and opens a
**PR** (never a direct commit to `main`) — plus a user-story GitHub Issue when
the repo's dark-factory `create_issue` policy calls for one. If the planner
judges the feature too large, it suggests **splitting** it into smaller focused
features, and the author can spin up a child draft **without leaving the page**.

The persistent Feature node is wired into the existing graph: on the Graph tab
it **replaces** the computed folder node, carrying its lifecycle status.

## Integration & Relationships

This feature is not an island — it sits on top of the existing pipeline, graph,
and spec machinery and feeds the rest of the system.

- **Task-to-Agent Pipeline (`specs/3-task-agent-pipeline`).** The planning and
  finalize Stations are two new `claude-code` task types running on the existing
  LoreTask CRD → Job pod → loretask-watcher path. No new orchestration runtime;
  it reuses task creation, the pod lifecycle, and PR creation.
- **Feature-request task type (`specs/3`).** This feature is the interactive,
  multi-round successor to one-shot `feature-request`: same end artifact (a
  `spec.md` PR following repo conventions), but with a human in the loop, a
  persistent draft, and gap-closing analysis. `feature-request` remains for the
  fully-automated path.
- **Dark Factory (`specs/6-dark-factory`, ADR-016).** Finalize reuses
  `dark_factory.create_issue` and the `decideIssueCreate` helper for the
  conditional user-story Issue, the `Lore-Task` PR-body trailer, and the
  per-repo trust level (`TRUST_LEVELS`) that gates who may run planning.
- **Spec-traceability graph (`specs/spec-traceability-graph`) & coverage
  (`specs/spec-test-coverage`).** The finalized `specs/<slug>/spec.md` is ingested
  like any spec: it becomes a Dgraph Feature/Spec/Statement subtree, and its
  acceptance criteria can carry inline `([validated by])` links. The persistent
  Feature node merges onto (and replaces) the computed folder node in the spec
  graph — so planning *closes the loop*, producing the spec that implementation
  tasks, spec-coverage, and drift detection then operate on.
- **Context assembly (`specs/context-assembly`, ADR-021/022).** The planning
  Station hydrates the whole-feature-timeline + project context through the same
  `/api/context` path used by every other Station.
- **Project facade & ports (ADR-024).** Feature lifecycle is a new `features`
  port on the Project object, alongside `tasks`, `pulls`, `audit`, etc. Execution
  honors the BYO container image (ADR-025) like any Station.
- **Downstream features.** A feature can spawn child features (split), forming a
  parent/child tree in `lore.features` and `splits_into` relationships; each child
  is itself a normal feature that finalizes to its own spec PR.

## User Personas

### Feature Author (Product Owner / PM)

Describes intent in plain language via the smart feature page. Iterates on the
returned gap analysis, steering each section. Wants the end result to be a spec
that stands as a user story in the repo. Does not write code.

### Developer

Browses the Features tab to understand what is planned and shipped. Reviews the
finalized spec PR alongside the code. May start a feature draft from a technical
prompt and split it into implementable pieces.

### Platform Engineer

Configures whether finalize creates a user-story Issue (dark-factory
`create_issue`), monitors planning Station runs via the pipeline/audit views,
and owns the trust level that gates who may run planning in a repo.

## User Scenarios & Acceptance Criteria

### Scenario 1: Draft from a prompt → planning Station → gap analysis

**Actor:** Feature Author

**Flow:**
1. Author opens the **Features** tab, clicks **+ Feature**, writes a prompt.
2. A draft `lore.features` row is created and a `feature-planning` task is kicked.
3. A Station (Job pod) clones the repo and assembles the whole-feature-timeline
   plus project context, then an agent produces a structured gap analysis.
4. The pod POSTs the result; the page renders gap sections — architecture, user
   flows, visual mockups, follow-up questions, free-form prompt.

**Acceptance Criteria:**
- The planning Station produces a `GapResult` that validates against the shared schema. ([validated by parseGapResult valid payload](../../libs/shared/src/feature-planning/gap-result.test.ts#L33))
- Planning makes no commits and opens no PR (the result is persisted, not committed).
- The planning Station starts only after the repo is cloned and the feature timeline + project context are assembled.
- Generated mockups render without executing embedded script (sandboxed, sanitized). ([validated by sanitizeSvg strips script](../../libs/shared/src/feature-planning/gap-result.test.ts#L56))

### Scenario 2: Iterative refinement with per-section direction

**Actor:** Feature Author

**Flow:**
1. The author reads each gap section.
2. Per section, the author leaves a comment and picks a direction (keep / refine / redirect).
3. The author optionally answers follow-up questions inline and adds free-form input.
4. **Refine again** spawns a new immediate planning round whose context includes
   the prior rounds' results and the author's per-section feedback.

**Acceptance Criteria:**
- Each gap section exposes its own comment and direction control.
- Per-section feedback, question answers, and free-form input persist as the round's `user_answers` and round-trip through storage. ([validated by appendIteration round-trips user_answers](../../libs/shared/src/project/features/features-pg.test.ts#L57))
- A refinement round's context includes the full prior feature timeline.
- The feature status reflects whether the round needs author input or is ready to finalize.

### Scenario 3: Finalize → spec PR (+ conditional user-story Issue)

**Actor:** Feature Author

**Flow:**
1. When satisfied, the author clicks **Proceed / Finalize**.
2. A finalize Station writes `specs/<slug>/spec.md` from the accumulated draft, commits, and pushes a branch.
3. The watcher opens a spec PR; if the repo's dark-factory `create_issue` policy applies, it also opens a user-story Issue cross-linked via the `Lore-Task` trailer.
4. The page shows the PR link and live PR status.

**Acceptance Criteria:**
- Finalize opens a PR on a branch and never commits to `main`.
- A user-story Issue is created if and only if the repo's `create_issue` policy calls for it.
- The feature transitions to `pr-open` and stores the PR (and Issue) references.
- The committed `specs/<slug>/spec.md` contains the feature overview and the macro decisions made during planning.

### Scenario 4: Split an oversized feature

**Actor:** Feature Author or Developer

**Flow:**
1. The planner judges the feature too large and returns a split suggestion with proposed sub-features.
2. The page renders the suggestion with a **Create draft** control per proposed sub-feature.
3. The author creates one or more child drafts without navigating away.

**Acceptance Criteria:**
- A split suggestion renders proposed sub-features the author can act on individually.
- Creating a child draft inserts a feature row linked to its parent and does not navigate away from the page. ([validated by createSplitChild links parent](../../libs/shared/src/project/features/features-pg.test.ts#L109))
- The child draft is immediately plannable from its proposed scope.

### Scenario 5: Features tab + graph integration

**Actor:** Developer

**Flow:**
1. The developer opens the **Features** tab and browses drafts and shipped features with status badges.
2. Opening a feature shows its draft spec, iteration history, gap sections, and PR status when finalized.
3. On the **Graph** tab, the persistent Feature node represents the feature, colored by status.

**Acceptance Criteria:**
- The Features list shows drafts and shipped features with a lifecycle status badge. ([validated by statusBadge maps status](../../apps/web-ui/src/app/repos/[owner]/[repo]/features/feature-status.test.ts#L5))
- When a persistent feature exists, the Graph tab uses it in place of the computed folder node, joined by feature path. ([validated by mergePersistentFeatures enriches by path](../../libs/shared/src/spec-trace/__tests__/merge-persistent-features.test.ts#L16))
- A draft feature with no spec yet appears as an injected node so it is visible before any spec exists. ([validated by mergePersistentFeatures injects draft](../../libs/shared/src/spec-trace/__tests__/merge-persistent-features.test.ts#L28))
- A persistent Feature node is rendered with a color derived from its lifecycle status.

## Functional Requirements

### FR-1: Features Tab, List & Detail

The system MUST surface features as a first-class browsable entity per repo.

- FR-1.1: A **Features** tab is registered on the repo page between Specs and ADRs.
- FR-1.2: The list shows drafts and shipped features for the repo, newest first, each with a status badge and a link to detail.
- FR-1.3: The detail view shows the current draft spec, the per-round iteration history, the latest gap sections, and — once finalized — the PR status and Issue link, plus a deep-link into the Graph tab.
- FR-1.4: The list degrades to an empty state when the `lore.features` table is absent (pre-migration safety) rather than erroring.

### FR-2: Smart Feature Creation & Planning Station

The system MUST analyze a feature prompt in the context of the project, in a pod.

- FR-2.1: **+ Feature** opens a page where the author submits a free-text prompt; submit creates a draft feature row and kicks a `feature-planning` task.
- FR-2.2: `feature-planning` and `feature-finalize` are `claude-code` task types that always run as Stations (Job pods) via the LoreTask CRD, independent of dark-factory enablement.
- FR-2.3: The planning Station receives the feature id and iteration; before the agent runs, the pod clones the repo and the hydrated context includes the full feature timeline (prior rounds' results + per-section answers) ahead of the assembled project context.
- FR-2.4: A per-feature iteration soft-cap bounds runaway refinement cost.

### FR-3: Gap-Closing Result

The planning agent MUST return a structured, schema-validated gap analysis.

- FR-3.1: The `GapResult` contract includes architecture, user flows, mockups (self-contained SVG), follow-up questions, an optional split suggestion, and the accumulated draft spec markdown.
- FR-3.2: The result is validated against a shared Zod schema; an invalid result marks the iteration failed.
- FR-3.3: Mockup markup is sanitized (no script, event handlers, foreignObject, or external references) before persistence and rendered in a sandboxed iframe in the UI.
- FR-3.4: The UI renderer is schema-driven and resilient to missing or unknown sections.

### FR-4: Per-Section Feedback & Iteration

The system MUST let the author steer each section and refine across rounds.

- FR-4.1: Each gap section exposes a comment field and a direction control (keep / refine / redirect).
- FR-4.2: Follow-up questions are answerable inline; a free-form input captures anything else.
- FR-4.3: **Refine again** spawns a new immediate `feature-planning` task carrying the per-section feedback; the UI polls the round and renders the new result.
- FR-4.4: Iteration rounds are stored one row per round, keyed by `(feature_id, iteration)`, each linked to the planning task that produced it.

### FR-5: Finalize Output

The system MUST produce a reviewable spec artifact, never a direct main commit.

- FR-5.1: Finalize runs a Station that writes `specs/<slug>/spec.md` from the draft, commits to a branch, and pushes.
- FR-5.2: The watcher opens the spec PR with the standard `Lore-Task` footer trailer.
- FR-5.3: A user-story Issue is created when, and only when, the repo's dark-factory `create_issue` policy resolves to create (reusing the existing decision helper).
- FR-5.4: The feature transitions to `pr-open` and records the PR number/URL, Issue number/URL, and `spec_path`.

### FR-6: Feature Splitting

The system MUST support decomposing an oversized feature in place.

- FR-6.1: When the agent returns a split suggestion, the UI renders the proposed sub-features.
- FR-6.2: Creating a child draft inserts a feature row with `parent_feature_id` set and seeds its prompt from the proposed scope, without navigating away.

### FR-7: Persistence & Project Port

The system MUST persist feature lifecycle through the Project facade.

- FR-7.1: Feature lifecycle and draft state live in `lore.features` and `lore.feature_iterations` (the `lore` schema, owned by the migration runner).
- FR-7.2: Access is a `features` port on the Project facade (`project.features`): create, get, list, append iteration, set iteration result, transition status, create split child.
- FR-7.3: The web UI reads features directly (read-only) and routes lifecycle/task-spawning writes through the mcp-server API.

### FR-8: Graph Integration

The system MUST make the persistent Feature node the source of truth in the graph.

- FR-8.1: The `trace/graph` endpoint merges persistent features onto the computed spec-graph Feature nodes, joined by `(repo, path)`.
- FR-8.2: A matching computed node is enriched with the persistent feature's id, status, and title (persistent wins).
- FR-8.3: A persistent draft with no spec yet is injected as a standalone Feature node.
- FR-8.4: Feature nodes are colored by lifecycle status in the D3 graph.

### FR-9: Migration Safety

The system MUST not break the UI deploy with its schema migration.

- FR-9.1: Migration `0017` creates its tables in the `lore` schema, is idempotent, and is single-transaction-safe (no concurrent index, no non-transactional DDL).
- FR-9.2: A local pre-flight applies the migration via the real apply path and proves an idempotent re-run before deploy.
- FR-9.3: A CI guard applies all migrations and re-applies the newest against an ephemeral Postgres, failing the build on any error.
