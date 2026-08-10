# Feature Specification: Smart Feature Planning

| Field          | Value                                       |
|----------------|---------------------------------------------|
| Feature        | Smart Feature Planning                      |
| Branch         | 7-feature-planning                          |
| Status         | In Progress                             |
| Created        | 2026-06-17                                  |
| Owner          | Platform Engineering                        |

Smart Feature Planning turns the fire-and-forget feature-request flow into an interactive, section-by-section drafting experience backed by a first-class draft Feature entity, letting a product owner shape a spec through gap-closing analysis and per-section direction before any PR is opened.

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
want. On submit, the platform assembles the *whole feature timeline plus project*
context and an agent produces a **gap-closing analysis** as an **adaptive set of
sections** — an **Overview** first, then whatever the feature actually needs (data
model, API, migration, integration, edge cases…), each carrying inline generated
mockups and **per-section follow-up questions** where they help, plus an
invitation for free-form direction. The author reviews each section, leaves
**per-section comments and direction**, and either refines (another round) or
**finalizes**.

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

- **Task-to-Agent Pipeline (`graveyard/specs/3-task-agent-pipeline`).** `feature-planning`
  and `feature-finalize` are two new task types on the existing pipeline. *(As designed,
  planning ran in-process and finalize on the LoreTask CRD path; since the ADR-031 cutover
  both run their own assembly-line definitions on the Station backend — see FR-2.2 for the
  current routing.)* No new orchestration runtime; it reuses task creation, the pod
  lifecycle, and PR creation.
- **Feature-request task type (`specs/3`).** This feature is the interactive,
  multi-round successor to one-shot `feature-request`: same end artifact (a
  `spec.md` PR following repo conventions), but with a human in the loop, a
  persistent draft, and gap-closing analysis. `feature-request` remains for the
  fully-automated path: its one-shot handler commits the three spec artifacts
  (`spec.md`/`data-model.md`/`tasks.md`) and only then opens the PR, and throws
  without opening a PR when the model SKIPs every artifact. ([validated by commits the three spec artifacts then opens the PR](apps/floor/src/jobs/task/handle-feature-request.test.ts#L75), [throws when every artifact is SKIP and opens no PR](apps/floor/src/jobs/task/handle-feature-request.test.ts#L103))
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
  round hydrates the whole-feature-timeline + project context through the same
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
`create_issue`), monitors planning runs via the pipeline/audit views,
and owns the trust level that gates who may run planning in a repo.

## User Scenarios & Acceptance Criteria

### Scenario 1: Draft from a prompt → planning round → gap analysis

**Actor:** Feature Author

**Flow:**
1. Author opens the **Features** tab, clicks **+ Feature**, writes a prompt.
2. A draft `lore.features` row is created and a `feature-planning` task is kicked.
3. The planning agent runs a single LLM→JSON round against the assembled
   whole-feature-timeline plus project context and produces a structured gap analysis.
4. The result is persisted and the page renders the gap as an adaptive list of
   sections (an Overview first, then feature-specific sections with inline mockups,
   per-section follow-up questions, and a free-form prompt).

**Acceptance Criteria:**
- The planning round produces a `GapResult` (an adaptive `sections[]` list) that validates against the shared schema. ([validated by parseGapResult valid sections payload](libs/shared/src/feature-planning/gap-result.test.ts#L64))
- Planning makes no commits and opens no PR (the result is persisted, not committed).
- The planning round runs only after the whole-feature-timeline + project context is assembled and hydrated ahead of the agent call. ([validated by composePlanningPrompt renders the prior timeline](libs/shared/src/feature-planning/planning-prompt.test.ts#L34))
- Generated mockups are sanitized so no embedded script, event handler, foreignObject, or external reference can execute when rendered. ([validated by sanitizeSvg strips script](libs/shared/src/feature-planning/gap-result.test.ts#L217))

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
- Per-section feedback, question answers, and free-form input persist as the round's `user_answers` and round-trip through storage. ([validated by appendIteration round-trips user_answers](libs/shared/src/project/features/features-pg.test.ts#L68))
- A refinement round's context includes the full prior feature timeline (each prior section's content plus the author's per-section comments and answers). ([validated by composePlanningPrompt renders prior sections + comments](libs/shared/src/feature-planning/planning-prompt.test.ts#L34))
- The feature status reflects whether the round needs author input or is ready to finalize: `awaiting-input` when any section carries questions or a split is suggested, `spec-ready` when neither. ([validated by decideFeatureStatus awaiting-input vs spec-ready](libs/shared/src/feature-planning/gap-result.test.ts#L275), [`gap-result.test.ts:279`](libs/shared/src/feature-planning/gap-result.test.ts#L279), [`gap-result.test.ts:292`](libs/shared/src/feature-planning/gap-result.test.ts#L292))

### Scenario 3: Finalize → spec PR (+ conditional user-story Issue)

**Actor:** Feature Author

**Flow:**
1. When satisfied, the author clicks **Proceed / Finalize**.
2. A finalize Station writes `specs/<slug>/spec.md` from the accumulated draft, commits, and pushes a branch.
3. The watcher opens a spec PR; if the repo's dark-factory `create_issue` policy applies, it also opens a user-story Issue cross-linked via the `Lore-Task` trailer.
4. The page shows the PR link and live PR status.

**Acceptance Criteria:**
- Finalize is allowed only from a settled planning state (`spec-ready`/`awaiting-input`) and runs as a Station that opens a PR on a branch, never committing to `main`. ([validated by handleFeaturesRoute refuses finalize unless settled](apps/lore-api/src/api/routes/features/features.test.ts#L116))
- A user-story Issue is created if and only if the repo's `create_issue` policy calls for it.
- The feature transitions to `pr-open` and stores the PR (and Issue) references. ([validated by handleFeaturesRoute kicks finalize from spec-ready](apps/lore-api/src/api/routes/features/features.test.ts#L133))
- The committed `specs/<slug>/spec.md` contains the feature overview and the macro decisions made during planning.

### Scenario 4: Split an oversized feature

**Actor:** Feature Author or Developer

**Flow:**
1. The planner judges the feature too large and returns a split suggestion with proposed sub-features.
2. The page renders the suggestion with a **Create draft** control per proposed sub-feature.
3. The author creates one or more child drafts without navigating away.

**Acceptance Criteria:**
- A split suggestion renders proposed sub-features the author can act on individually.
- Creating a child draft inserts a feature row linked to its parent and does not navigate away from the page. ([validated by createSplitChild links parent](libs/shared/src/project/features/features-pg.test.ts#L188))
- The child draft is immediately plannable from its proposed scope. ([validated by handleFeaturesRoute creates a split child from the suggestion](apps/lore-api/src/api/routes/features/features.test.ts#L174))

### Scenario 5: Features tab + graph integration

**Actor:** Developer

**Flow:**
1. The developer opens the **Features** tab and browses drafts and shipped features with status badges.
2. Opening a feature shows its draft spec, iteration history, gap sections, and PR status when finalized.
3. On the **Graph** tab, the persistent Feature node represents the feature, colored by status.

**Acceptance Criteria:**
- The Features list shows drafts and shipped features with a lifecycle status badge. ([validated by statusBadge maps status](apps/web-ui/src/app/repos/[owner]/[repo]/features/feature-status.test.ts#L9))
- When a persistent feature exists, the Graph tab uses it in place of the computed folder node, joined by feature path. ([validated by mergePersistentFeatures enriches by path](libs/shared/src/spec-trace/merge-persistent-features.test.ts#L23))
- A draft feature with no spec yet appears as an injected node so it is visible before any spec exists. ([validated by mergePersistentFeatures injects draft](libs/shared/src/spec-trace/merge-persistent-features.test.ts#L41))
- A persistent Feature node is rendered with a color derived from its lifecycle status.

## Functional Requirements

### FR-1: Features Tab, List & Detail

The system MUST surface features as a first-class browsable entity per repo.

- FR-1.1: A **Features** tab is registered on the repo page between Specs and ADRs.
- FR-1.2: The list shows drafts and shipped features for the repo, newest first, each with a status badge and a link to detail.
- FR-1.3: The detail view shows the current draft spec, the per-round iteration history, the latest gap sections, and — once finalized — the PR status and Issue link, plus a deep-link into the Graph tab.
- FR-1.4: The list degrades to an empty state when the `lore.features` table is absent (pre-migration safety) rather than erroring.
- FR-1.5: The feature GET endpoint returns 404 for an unknown feature id. ([validated by handleFeaturesRoute returns 404 for a missing feature on GET](apps/lore-api/src/api/routes/features/features.test.ts#L201))

### FR-2: Smart Feature Creation & Planning

The system MUST analyze a feature prompt in the context of the whole project.

- FR-2.1: **+ Feature** opens a page where the author submits a free-text prompt; submit creates a draft feature row and kicks a `feature-planning` task. ([validated by handleFeaturesRoute creates a draft and kicks round 1](apps/lore-api/src/api/routes/features/features.test.ts#L87))

The submitted title and prompt are trimmed and required, capped at 256 and 8000 characters respectively, and rejected with a `ValidationError` otherwise — the route echoes this as a `400 { error: "title and prompt are required" }` before touching the project. ([validated by `feature-input.test.ts:9`](libs/shared/src/feature-planning/feature-input.test.ts#L9), [`feature-input.test.ts:18`](libs/shared/src/feature-planning/feature-input.test.ts#L18), [`feature-input.test.ts:24`](libs/shared/src/feature-planning/feature-input.test.ts#L24), [`feature-input.test.ts:30`](libs/shared/src/feature-planning/feature-input.test.ts#L30), [`feature-input.test.ts:36`](libs/shared/src/feature-planning/feature-input.test.ts#L36), [handleFeaturesRoute rejects a blank-title create with 400](apps/lore-api/src/api/routes/features/features.test.ts#L107))
- FR-2.2: *(restated late 2026-07)* Both task types run their own assembly line on the Station backend regardless of dark-factory enablement — the worker always forwards the definition name for them, so `feature-planning` runs its single `analyze` agent node (no commit or PR — the pod posts the GapResult back to the features API) and `feature-finalize` runs `write → push` (one Agent CR per node); the original in-process handlers survive only behind the explicit `LORE_STATION_BACKEND=inprocess` escape hatch for a dev machine without Docker or credentials ([impl](apps/floor/src/jobs/task/worker.ts))
- FR-2.3: The planning round receives the feature id and iteration; the hydrated context includes the full feature timeline (prior rounds' results + per-section answers) ahead of the assembled project context. Round one wraps the title and user prompt and omits the draft spec; later rounds render each prior section's content, the author's per-section comment, and each follow-up question with its asked text and answer (or an unanswered marker). ([validated by composePlanningPrompt renders the prior timeline](libs/shared/src/feature-planning/planning-prompt.test.ts#L34), [`planning-prompt.test.ts:21`](libs/shared/src/feature-planning/planning-prompt.test.ts#L21), [`planning-prompt.test.ts:59`](libs/shared/src/feature-planning/planning-prompt.test.ts#L59), [`planning-prompt.test.ts:71`](libs/shared/src/feature-planning/planning-prompt.test.ts#L71))
- FR-2.4: The planning prompt and model resolve from the `feature-planning` agent definition — an editable org default, overridable per project — rather than a hardcoded constant. ([validated by agent-defs serves PLANNING_INSTRUCTIONS for feature-planning](libs/shared/src/project/agents/agent-defs-yaml.test.ts#L83))
- FR-2.5: The planning round bills org credentials (`ANTHROPIC_API_KEY`) by default; a developer's local Claude subscription is used only with explicit opt-in (`LORE_STATION_ALLOW_PERSONAL_AUTH`), never silently.
- FR-2.6: The offline `PLANNING_INSTRUCTIONS` define the planning contract — an Overview-first (a question-free `Overview` section), gap-closing, `## Integration`-focused analysis — pin the dynamic-sections schema field names (`sections`/`content`/`questions`/`why`/`mockups`/`split_suggestion`), and forbid task-sizing / user-story / ordering questions; the shipped `PLANNING_EXAMPLE` itself validates against the `GapResult` schema. ([validated by `planning-instructions.test.ts:31`](libs/shared/src/feature-planning/planning-instructions.test.ts#L31), [`planning-instructions.test.ts:18`](libs/shared/src/feature-planning/planning-instructions.test.ts#L18), [`planning-instructions.test.ts:37`](libs/shared/src/feature-planning/planning-instructions.test.ts#L37), [`planning-instructions.test.ts:9`](libs/shared/src/feature-planning/planning-instructions.test.ts#L9), [`planning-instructions.test.ts:13`](libs/shared/src/feature-planning/planning-instructions.test.ts#L13))

### FR-3: Gap-Closing Result

The planning agent MUST return a structured, schema-validated gap analysis.

- FR-3.1: The `GapResult` contract is an ordered, **adaptive `sections[]`** list — the agent names the sections the feature needs (Overview first, then e.g. data model / API / migration / integration / edge cases), each carrying optional prose `content`, self-contained SVG `mockups`, and per-section follow-up `questions` — plus an optional split suggestion and the accumulated draft spec markdown. The parser tolerates model drift: an absent split suggestion, a question given via `text` (minting the missing `id`/`why`), a mockup given as a bare SVG string, an explicit empty sections list, and a legacy `architecture`/`user_flows` payload folded into named sections. ([validated by parseGapResult valid sections payload](libs/shared/src/feature-planning/gap-result.test.ts#L64), [`gap-result.test.ts:90`](libs/shared/src/feature-planning/gap-result.test.ts#L90), [`gap-result.test.ts:96`](libs/shared/src/feature-planning/gap-result.test.ts#L96), [`gap-result.test.ts:118`](libs/shared/src/feature-planning/gap-result.test.ts#L118), [`gap-result.test.ts:131`](libs/shared/src/feature-planning/gap-result.test.ts#L131), [`gap-result.test.ts:152`](libs/shared/src/feature-planning/gap-result.test.ts#L152))
- FR-3.2: The model output is fence-stripped and JSON-parsed (a malformed body raises a contextual error naming the truncated snippet) and then validated against the shared schema; an invalid result marks the iteration failed. Validation rejects a non-object root, a missing `draft_spec_markdown`, a choice question with no or empty `options`, and a `split_suggestion` missing `proposed_features`. ([validated by `model-json.test.ts:5`](libs/shared/src/feature-planning/model-json.test.ts#L5), [`model-json.test.ts:9`](libs/shared/src/feature-planning/model-json.test.ts#L9), [`model-json.test.ts:13`](libs/shared/src/feature-planning/model-json.test.ts#L13), [`model-json.test.ts:19`](libs/shared/src/feature-planning/model-json.test.ts#L19), [`model-json.test.ts:23`](libs/shared/src/feature-planning/model-json.test.ts#L23), [`model-json.test.ts:27`](libs/shared/src/feature-planning/model-json.test.ts#L27), [`model-json.test.ts:33`](libs/shared/src/feature-planning/model-json.test.ts#L33), [`gap-result.test.ts:68`](libs/shared/src/feature-planning/gap-result.test.ts#L68), [`gap-result.test.ts:74`](libs/shared/src/feature-planning/gap-result.test.ts#L74), [`gap-result.test.ts:159`](libs/shared/src/feature-planning/gap-result.test.ts#L159), [`gap-result.test.ts:146`](libs/shared/src/feature-planning/gap-result.test.ts#L146), [`gap-result.test.ts:181`](libs/shared/src/feature-planning/gap-result.test.ts#L181))
- FR-3.3: Mockup markup is sanitized (no script, event handlers, foreignObject, or external references) before persistence and again client-side via DOMPurify when rendered inline (no iframe); `sanitizeSvg` strips inline event-handler attributes, `javascript:` hrefs, and `foreignObject` elements while leaving a clean SVG (including a fragment `href`) unchanged. ([validated by sanitizeGapResult sanitizes mockup markup across every section](libs/shared/src/feature-planning/gap-result.test.ts#L251), [`gap-result.test.ts:223`](libs/shared/src/feature-planning/gap-result.test.ts#L223), [`gap-result.test.ts:229`](libs/shared/src/feature-planning/gap-result.test.ts#L229), [`gap-result.test.ts:235`](libs/shared/src/feature-planning/gap-result.test.ts#L235), [`gap-result.test.ts:243`](libs/shared/src/feature-planning/gap-result.test.ts#L243))
- FR-3.4: The UI renderer is presence-driven (renders whatever fields a section carries) and resilient to missing or unknown sections; `sectionsOf` returns the sections of a new-shape result, derives them from a raw legacy-shape object, and returns `[]` for null or unrecognized input. ([validated by `gap-result.test.ts:195`](libs/shared/src/feature-planning/gap-result.test.ts#L195), [`gap-result.test.ts:202`](libs/shared/src/feature-planning/gap-result.test.ts#L202), [`gap-result.test.ts:210`](libs/shared/src/feature-planning/gap-result.test.ts#L210))

### FR-4: Per-Section Feedback & Iteration

The system MUST let the author steer each section and refine across rounds.

- FR-4.1: Each gap section exposes a comment field and a direction control (keep / refine / redirect). The answers parser keeps a known direction with its comment, drops an unknown direction, and returns null for a non-object or wholly-empty payload. ([validated by `feature-input.test.ts:56`](libs/shared/src/feature-planning/feature-input.test.ts#L56), [`feature-input.test.ts:44`](libs/shared/src/feature-planning/feature-input.test.ts#L44), [`feature-input.test.ts:50`](libs/shared/src/feature-planning/feature-input.test.ts#L50))
- FR-4.2: Follow-up questions are answerable inline; a free-form input captures anything else. The parser keeps only string question answers and coerces free-form text, filling empty section and question maps. ([validated by `feature-input.test.ts:70`](libs/shared/src/feature-planning/feature-input.test.ts#L70), [`feature-input.test.ts:78`](libs/shared/src/feature-planning/feature-input.test.ts#L78))
- FR-4.3: **Refine again** spawns a new immediate `feature-planning` task carrying the per-section feedback; the UI polls the round and renders the new result. ([validated by feature-api refine posts user_answers to the iterations path](apps/web-ui/src/lib/feature-api.test.ts#L79))
- FR-4.4: Iteration rounds are stored one row per round, keyed by `(feature_id, iteration)`, each linked to the planning task that produced it. ([validated by appendIteration inserts a running row at the minted iteration](libs/shared/src/project/features/features-pg.test.ts#L68))
- FR-4.5: A new planning round is rejected while one is already in flight for the same feature (a stale page or double-click must not spawn a second round). ([validated by handleFeaturesRoute rejects a concurrent planning round with 409](apps/lore-api/src/api/routes/features/features.test.ts#L238))
- FR-4.6: The in-memory features double is the behavioral spec of the Pg adapter over `lore.features` + `lore.feature_iterations`: `create` inserts a draft with slug/path derived from the title (creator defaulting to `ui`) and `createSplitChild` links the child to its parent; `get` returns iterations oldest-first and null for the wrong repo; `list` filters by repo and status newest-updated first; `appendIteration` mints the next counter, flips the feature to `planning`, inserts a `running` round, and throws for a missing feature (the Pg adapter's unguarded RETURNING deref); iteration writes are repo-scoped through the owning feature so a wrong repo writes nothing; `transitionStatus` applies only the defined `FeaturePatch` fields; and `delete` cascades the iterations, returning false when absent. ([validated by `features-memory.test.ts:14`](libs/shared/src/project/features/features-memory.test.ts#L14), [`features-memory.test.ts:34`](libs/shared/src/project/features/features-memory.test.ts#L34), [`features-memory.test.ts:51`](libs/shared/src/project/features/features-memory.test.ts#L51), [`features-memory.test.ts:63`](libs/shared/src/project/features/features-memory.test.ts#L63), [`features-memory.test.ts:81`](libs/shared/src/project/features/features-memory.test.ts#L81), [`features-memory.test.ts:102`](libs/shared/src/project/features/features-memory.test.ts#L102), [`features-memory.test.ts:112`](libs/shared/src/project/features/features-memory.test.ts#L112), [`features-memory.test.ts:140`](libs/shared/src/project/features/features-memory.test.ts#L140), [`features-memory.test.ts:161`](libs/shared/src/project/features/features-memory.test.ts#L161), [`features-memory.test.ts:174`](libs/shared/src/project/features/features-memory.test.ts#L174))

### FR-5: Finalize Output

The system MUST produce a reviewable spec artifact, never a direct main commit.

- FR-5.1: Finalize runs a Station that writes `specs/<slug>/spec.md` from the draft, commits to a branch, and pushes. ([validated by handleFeaturesRoute kicks finalize from a spec-ready feature](apps/lore-api/src/api/routes/features/features.test.ts#L133))
- FR-5.2: The watcher opens the spec PR with the standard `Lore-Task` footer trailer.
- FR-5.3: A user-story Issue is created when, and only when, the repo's dark-factory `create_issue` policy resolves to create (reusing the existing decision helper).
- FR-5.4: The feature transitions to `pr-open` and records the PR number/URL, Issue number/URL, and `spec_path`.

### FR-6: Feature Splitting

The system MUST support decomposing an oversized feature in place.

- FR-6.1: When the agent returns a split suggestion, the UI renders the proposed sub-features.
- FR-6.2: Creating a child draft inserts a feature row with `parent_feature_id` set and seeds its prompt from the proposed scope, without navigating away. ([validated by createSplitChild inserts a child with parent_feature_id](libs/shared/src/project/features/features-pg.test.ts#L188))
- FR-6.3: The split endpoint refuses (409) when the latest ready planning round carries no split suggestion. ([validated by handleFeaturesRoute refuses split without a suggestion](apps/lore-api/src/api/routes/features/features.test.ts#L152))

### FR-7: Persistence & Project Port

The system MUST persist feature lifecycle through the Project facade.

- FR-7.1: Feature lifecycle and draft state live in `lore.features` and `lore.feature_iterations` (the `lore` schema, owned by the migration runner). ([validated by PgFeatures.create inserts into lore.features](libs/shared/src/project/features/features-pg.test.ts#L27))
- FR-7.2: Access is a `features` port on the Project facade (`project.features`): create, get, list, append iteration, set iteration result, transition status, create split child. ([validated by the Features facade stamps the bound repo on every call](libs/shared/src/project/features/features.test.ts#L35))
- FR-7.3: The web UI reads features directly (read-only) and routes lifecycle/task-spawning writes through the mcp-server API. ([validated by feature-api create posts to /features](apps/web-ui/src/lib/feature-api.test.ts#L60))
- FR-7.4: The feature DELETE endpoint requires a `write`-scoped token — a read-scoped token is refused 403 before the project is touched — and returns `{ ok: true }` (200) when a row is removed or 404 when nothing matched. ([validated by handleFeaturesRoute returns 200 on delete and 404 when nothing was removed](apps/lore-api/src/api/routes/features/features.test.ts#L208), [`features.test.ts:221`](apps/lore-api/src/api/routes/features/features.test.ts#L221), [`features.test.ts:230`](apps/lore-api/src/api/routes/features/features.test.ts#L230))

### FR-8: Graph Integration

The system MUST make the persistent Feature node the source of truth in the graph.

- FR-8.1: The `trace/graph` endpoint merges persistent features onto the computed spec-graph Feature nodes, joined by `(repo, path)`. ([validated by mergePersistentFeatures enriches a node sharing the path](libs/shared/src/spec-trace/merge-persistent-features.test.ts#L23))
- FR-8.2: A matching computed node is enriched with the persistent feature's id, status, and title (persistent wins). ([validated by mergePersistentFeatures enriches by path, persistent wins](libs/shared/src/spec-trace/merge-persistent-features.test.ts#L23))
- FR-8.3: A persistent draft with no spec yet is injected as a standalone Feature node. ([validated by mergePersistentFeatures injects a standalone draft node](libs/shared/src/spec-trace/merge-persistent-features.test.ts#L41))
- FR-8.4: Feature nodes are colored by lifecycle status in the D3 graph.

### FR-9: Migration Safety

The system MUST not break the UI deploy with its schema migration.

- FR-9.1: Migration `0017` creates its tables in the `lore` schema, is idempotent, and is single-transaction-safe (no concurrent index, no non-transactional DDL).
- FR-9.2: A local pre-flight applies the migration via the real apply path and proves an idempotent re-run before deploy.
- FR-9.3: A CI guard applies all migrations and re-applies the newest against an ephemeral Postgres, failing the build on any error.

### FR-10: Planning Reliability & Recovery

The system MUST self-heal planning rounds left stuck by a crash or restart.

- FR-10.1: A reaper job reconciles mid-planning features every minute: a round still `running` whose Station container/pod is gone is marked failed and the feature is restored to its last good analysis (or `draft`). The set of statuses the reaper treats as mid-planning (`draft`/`planning`/`awaiting-input`/`spec-ready`, and only those) is a single `isPlanningPhase` predicate. ([validated by decidePlanningRecovery orphans a round whose runtime is gone](libs/shared/src/project/features/planning-recovery.test.ts#L31), [`gap-result.test.ts:306`](libs/shared/src/feature-planning/gap-result.test.ts#L306), [`gap-result.test.ts:314`](libs/shared/src/feature-planning/gap-result.test.ts#L314))
- FR-10.2: Orphan detection probes the actual runtime (`StationBackend.isActive` — `docker ps` locally, the LoreTask CR on the cluster), so a dead round is recovered immediately rather than only after a timeout window; an age window is a fallback for a wedged-but-listed container.
- FR-10.3: A round that produced a `ready` result while the feature is still `planning` (a missed, non-atomic status transition) has its transition re-applied. ([validated by decidePlanningRecovery re-applies a missed transition](libs/shared/src/project/features/planning-recovery.test.ts#L84))

### FR-11: Spec Decomposition (planning → implementation handoff)

The system MUST turn a merged feature spec into an implementable story/task tree
(ADR-029). Planning produces the spec; decomposition produces the work.

- FR-11.1: When a feature's finalize PR merges, a `feature-decompose` task is kicked automatically — reusing the same merge detection that syncs `feature-request` spec-tasks — and is idempotent per `(repo, spec_slug)` so a re-merge or replay never duplicates stories or tasks. ([validated by decideDecomposeKick fires for a finalize task carrying a feature id](apps/floor/src/jobs/task/handle-feature-decompose.test.ts#L5), [does not kick for a non-finalize task type](apps/floor/src/jobs/task/handle-feature-decompose.test.ts#L14), [does not kick a finalize task with no feature id](apps/floor/src/jobs/task/handle-feature-decompose.test.ts#L25), [impl](apps/floor/src/jobs/merge/merge-check.ts))
- FR-11.2: The decomposition agent reads the merged `specs/<slug>/spec.md` and returns a schema-validated `DecompositionResult`: an ordered list of user stories, each with a summary, acceptance criteria, and its implementable tasks (id, description, dependencies, phase, parallelizable, file hint). An invalid result fails the task — the root must be an object, `stories` an array (empty is allowed), and each story must carry a title; the parser defaults a story's missing summary/criteria/tasks, coerces a single-string `acceptance_criteria` to a list, normalizes tasks given as bare strings (minting sequential ids) or with `text`/single-string `depends_on` drift, and rejects a task with no description. ([validated by parseDecomposition accepts a valid stories payload](libs/shared/src/feature-planning/decomposition-result.test.ts#L38), [`decomposition-result.test.ts:42`](libs/shared/src/feature-planning/decomposition-result.test.ts#L42), [`decomposition-result.test.ts:48`](libs/shared/src/feature-planning/decomposition-result.test.ts#L48), [`decomposition-result.test.ts:55`](libs/shared/src/feature-planning/decomposition-result.test.ts#L55), [`decomposition-result.test.ts:59`](libs/shared/src/feature-planning/decomposition-result.test.ts#L59), [`decomposition-result.test.ts:65`](libs/shared/src/feature-planning/decomposition-result.test.ts#L65), [`decomposition-result.test.ts:78`](libs/shared/src/feature-planning/decomposition-result.test.ts#L78), [`decomposition-result.test.ts:86`](libs/shared/src/feature-planning/decomposition-result.test.ts#L86), [`decomposition-result.test.ts:109`](libs/shared/src/feature-planning/decomposition-result.test.ts#L109), [`decomposition-result.test.ts:129`](libs/shared/src/feature-planning/decomposition-result.test.ts#L129), [impl](libs/shared/src/feature-planning/decomposition-result.ts))
- FR-11.3: Each user story becomes a GitHub Issue (`User story: <title>`, labeled `lore-managed`/`user-story`, body linking the spec + feature), unless the repo's dark-factory `create_issue` policy resolves to never — then tasks-only. ([validated by storyIssueBody renders summary, acceptance criteria, tasks, and the spec link](libs/shared/src/feature-planning/decomposition-plan.test.ts#L77), [impl](apps/floor/src/jobs/task/handle-feature-decompose.ts))
- FR-11.4: Each task becomes a `spec-task` pipeline row carrying its story Issue number and `feature_id`, compatible with the existing implementation pipeline + trust gate (no new runner); in tasks-only mode (no Issue) the `story_issue` field is omitted while `feature_id` is still set. ([validated by specTaskRows links each task to its story issue and feature](libs/shared/src/feature-planning/decomposition-plan.test.ts#L32), [`decomposition-plan.test.ts:68`](libs/shared/src/feature-planning/decomposition-plan.test.ts#L68), [impl](libs/shared/src/feature-planning/decomposition-plan.ts))
- FR-11.5: The decomposition prompt and model resolve from the `feature-decompose` agent definition (editable org default, project override); the offline fallback is the shared `DECOMPOSITION_INSTRUCTIONS` constant, which documents the output contract (`stories`/`acceptance_criteria`/`depends_on`/`tasks`) and frames the job as turning the settled spec into user-story work rather than re-planning it, alongside a `DECOMPOSITION_EXAMPLE` that parses cleanly and shows a cross-task dependency. ([`decomposition-instructions.test.ts:9`](libs/shared/src/feature-planning/decomposition-instructions.test.ts#L9), [`decomposition-instructions.test.ts:20`](libs/shared/src/feature-planning/decomposition-instructions.test.ts#L20), [`decomposition-instructions.test.ts:27`](libs/shared/src/feature-planning/decomposition-instructions.test.ts#L27), [`decomposition-instructions.test.ts:34`](libs/shared/src/feature-planning/decomposition-instructions.test.ts#L34), [impl](libs/shared/src/feature-planning/decomposition-instructions.ts))
- FR-11.6: Decomposition runs in-process in the coordinator (the LLM analysis plus the Issue/pipeline writes are coordinator-side; no repo mutation, no pod). ([impl](apps/floor/src/jobs/task/worker.ts))
- FR-11.7: The feature detail view surfaces the resulting stories and the status of their tasks. ([impl](apps/web-ui/src/app/repos/[owner]/[repo]/features/[id]/DecompositionView.tsx))

### FR-12: Round Observability

A planning round is an assembly line, so the author MUST be able to watch it run
rather than infer progress from a spinner and an elapsed timer.

- FR-12.1: While a round is running, the card that announces it also renders the round's live run visualization — the definition graph, the node transcript, and the connection state — alongside the round number and the elapsed/budget timer. ([validated by RunningCard announces the round number and the elapsed / budget timer](apps/web-ui/src/app/repos/[owner]/[repo]/features/[id]/RunningCard.test.tsx#L45), [`RunningCard.test.tsx:60`](apps/web-ui/src/app/repos/[owner]/[repo]/features/[id]/RunningCard.test.tsx#L62), [impl](apps/web-ui/src/app/repos/[owner]/[repo]/features/[id]/RunningCard.tsx))
- FR-12.2: The graph MUST draw from the round's first moment, before the walk has recorded a single node row — so `feature-planning` and `feature-finalize` are declared graphs in the web UI's builtin set rather than shapes inferred from visit rows. A run of an undeclared definition still degrades to the inferred chain, marked synthetic so edge labels are suppressed. ([validated by toFeatureRunPayload resolves the declared feature-planning graph for a run with no visit rows](apps/web-ui/src/lib/feature-run.test.ts#L37), [`feature-run.test.ts:61`](apps/web-ui/src/lib/feature-run.test.ts#L61), [impl](apps/web-ui/src/lib/builtin-definitions.ts))
- FR-12.3: The run reaches the wizard through the poll it already runs — the latest assembly line for the round's task, its visit rows, and the resolved graph — so a round that starts after the page rendered appears on the next tick with no second fetch loop. A round with no task or no run row yet reports no run rather than failing the poll. ([validated by toFeatureRunPayload keeps the visit rows so the panel can colour the nodes](apps/web-ui/src/lib/feature-run.test.ts#L55), [`feature-run.test.ts:70`](apps/web-ui/src/lib/feature-run.test.ts#L70), [`RunningCard.test.tsx:80`](apps/web-ui/src/app/repos/[owner]/[repo]/features/[id]/RunningCard.test.tsx#L82), [impl](apps/web-ui/src/lib/feature-run.ts))
- FR-12.4: The local-Docker station log tail stays available alongside the visualization, since that backend records no run events. ([validated by RunningCard shows the local station log tail when one is available](apps/web-ui/src/app/repos/[owner]/[repo]/features/[id]/RunningCard.test.tsx#L95))

### FR-13: Failure Visibility

A round that dies MUST say why. The wizard previously guessed, because nothing on
the cluster path ever recorded a cause.

- FR-13.1: A planning round is finished only when its GapResult actually landed. A line that ends without one — whatever its outcome — marks the iteration `failed` and restores the feature per the same rule the synchronous path uses, instead of leaving the round `running` and the wizard spinning forever. A round that did post its result is left untouched. ([validated by settleTaskForLine marks the planning round failed and reverts the feature to draft when the line failed](apps/floor/src/jobs/assembly-line/settle-task.test.ts#L98), [`settle-task.test.ts:119`](apps/floor/src/jobs/assembly-line/settle-task.test.ts#L119), [`settle-task.test.ts:164`](apps/floor/src/jobs/assembly-line/settle-task.test.ts#L164), [impl](apps/floor/src/jobs/assembly-line/settle-task.ts))
- FR-13.2: The failure block reports the recorded cause — the task's `failure_reason` first, else the line's own reason — and keeps the "could not reach the model" hint only for a failure that recorded neither. ([validated by FailureBlock shows the task's failure reason instead of the ANTHROPIC_API_KEY guess](apps/web-ui/src/app/repos/[owner]/[repo]/features/[id]/FailureBlock.test.tsx#L9), [`FailureBlock.test.tsx:25`](apps/web-ui/src/app/repos/[owner]/[repo]/features/[id]/FailureBlock.test.tsx#L27), [`FailureBlock.test.tsx:40`](apps/web-ui/src/app/repos/[owner]/[repo]/features/[id]/FailureBlock.test.tsx#L47), [`FailureBlock.test.tsx:83`](apps/web-ui/src/app/repos/[owner]/[repo]/features/[id]/FailureBlock.test.tsx#L92), [`feature-run.test.ts:76`](apps/web-ui/src/lib/feature-run.test.ts#L76), [impl](apps/web-ui/src/app/repos/[owner]/[repo]/features/[id]/FailureBlock.tsx))
- FR-13.3: A failed round links to its run, so the full transcript is one click away; a round with no run shows no link. ([validated by FailureBlock links to the run transcript when the round has a run](apps/web-ui/src/app/repos/[owner]/[repo]/features/[id]/FailureBlock.test.tsx#L61), [`FailureBlock.test.tsx:70`](apps/web-ui/src/app/repos/[owner]/[repo]/features/[id]/FailureBlock.test.tsx#L77))
- FR-13.4: A per-task GitHub token that mints empty MUST fail at the mint, naming the repo and the App variables to check. An empty token writes a present-but-useless Secret key, so the pod starts and then dies in its init container on `git clone` with GitHub's deliberately uninformative "Repository not found" — a cause visible only in pod logs. ([validated by GithubTokenMinter throws naming the repo and the App vars when the token comes back empty](apps/floor/src/jobs/station/kube-token-provisioner.test.ts#L13), [`kube-token-provisioner.test.ts:5`](apps/floor/src/jobs/station/kube-token-provisioner.test.ts#L5), [impl](apps/floor/src/jobs/station/kube-token-provisioner.ts))

### Scenario 6: A merged spec decomposes into stories + tasks

**Actor:** Developer / pipeline

**Flow:**
1. A finalized feature's spec PR is merged to `main`.
2. The merge kicks `feature-decompose`; the agent reads the spec and returns a story/task tree.
3. One Issue is opened per user story; one `spec-task` row is created per task, linked to its story and feature.
4. The implementation pipeline picks up the tasks under the repo's trust gate.

**Acceptance Criteria:**
- Decomposition fires on spec-PR merge and is skipped when the feature already has spec-tasks. ([validated by decideDecomposeKick fires for a finalize task carrying a feature id](apps/floor/src/jobs/task/handle-feature-decompose.test.ts#L5))
- The agent's `DecompositionResult` validates against the shared schema; an invalid result fails the round. ([validated by parseDecomposition accepts a valid stories payload](libs/shared/src/feature-planning/decomposition-result.test.ts#L38))
- A story Issue is created per story unless the dark-factory `create_issue` policy says never. ([validated by storyIssueBody renders the story Issue](libs/shared/src/feature-planning/decomposition-plan.test.ts#L77))
- Each task is a `spec-task` row linked to its story Issue and feature, runnable by the existing pipeline. ([validated by specTaskRows links each task to its story issue and feature](libs/shared/src/feature-planning/decomposition-plan.test.ts#L32))
