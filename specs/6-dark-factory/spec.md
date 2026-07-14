# Feature Specification: Dark Factory Mode

> **Execution substrate moved (ADR-031, `specs/floor-on-ai-subsystem/`).** Dark Factory's
> policy (issue suppression, auto-merge, branch-as-state, audit) is unchanged, but the
> tasks it governs now run on the ai-agent-subsystem's `Agent` CRs, not `LoreTask` CRs —
> read the `LoreTask`-specific mechanics here in the past tense.

| Field    | Value                          |
|----------|--------------------------------|
| Feature  | Dark Factory Mode              |
| Branch   | 6-dark-factory                 |
| Status   | Implemented                    |
| Created  | 2026-04-28                     |
| Owner    | Platform Engineering           |

## Problem Statement

Lore today defaults to maximum chatter. Every pipeline task produces a
parallel ledger of artifacts that humans must look at: a GitHub Issue
with status comments, a LoreTask custom resource with status fields, a
`pipeline.tasks` row, Slack messages on every PR open, bot review
comments on every PR, and N stage transitions across CR controller →
Job pod → watcher → review CR → review Job → review reactor.

For a single implementation task this produces ~14 distinct artifacts
of which only three are durable a year later: the branch, the merged
PR, and the curated episode. Everything else is "watch me work"
theater that the team has stopped reading — evidenced by routine
auto-generated PRs sitting open for 8+ days with green CI before being
manually triaged or closed.

The pain compounds across flow types:

1. **Implementation flow** runs four ephemeral Job pods minimum
   (impl → review → address → re-review) with state handed off between
   them via Kubernetes custom resources, GitHub Issues, comments, and
   database rows. A pod death mid-iteration loses partial work because
   state lives in three places at once.

2. **Spec / gap-fill / runbook flows** create the same machinery for
   doc-only output: an Issue, status comments, an opened PR, a bot
   review, and a human approval. Humans cannot keep up, so PRs stale.

3. **Feature-request flow** produces a spec PR that humans review,
   then later N implementation PRs they review again. A four-task
   feature is five review touchpoints for the same intent.

4. **Onboarding flow** gates value on a human merging the bot's
   onboarding PR before any context becomes available.

5. **Local runner flow** demonstrates the inverse: one process, one
   PR, no Issue, no CR, no parallel ledger. State lives in the
   worktree and the branch. This is the model.

The result is a system that is technically autonomous (the agents do
the work) but practically not (humans still touch every artifact),
and that is fragile to pod death because durable state is fragmented
across CR / DB / Issue / PR / branch.

## Vision

Lore operates as a **dark software factory**. Autonomous operation is
the default. Humans participate at exactly two points: **intent
definition** (what should the system build) and **stage-gate
validation** (was this output acceptable). Everything between is
machine-internal and produces no human-facing artifact unless an
exception requires escalation.

Three coordinated changes deliver this vision:

1. **Branch as durable state.** Every workflow phase ends with a
   commit carrying structured trailers (`Lore-Stage:`,
   `Lore-Iteration:`, `Lore-Task:`). The branch is the audit trail.
   A supervisor pod that dies resumes by reading `git log` on the
   branch — no database checkpoints, no CR status sync, no parallel
   ledger.

2. **Workflow as declarative graph.** The implicit chain
   `implement → validate → push → review → address → re-review` is
   externalized into a YAML/DOT-style directed graph: nodes are
   stages (agent prompts, validation steps, gate checks), edges
   carry conditions on commit / CI / review outcomes. New flows are
   new graphs, not new code paths. The local runner and the GKE
   supervisor interpret the same graph.

3. **Human gates are opt-out, not opt-in.** A per-repo `dark_factory`
   setting block flips the defaults: GitHub Issues are created only
   for exception surfaces (approval gate required, escalation needed,
   or explicit per-repo opt-in). Auto-merge is enabled for
   low-blast-radius paths on green CI + bot approval + sufficient
   trust level. Slack notifications fire for escalations and watched
   completions only. The progressive-trust system — already present
   — gates which paths qualify for auto-merge.

The feature is observable end-to-end: every task's lifecycle is
reconstructable from the branch's commit history, every auto-merge
records the trust decision in the audit log, and every escalation
produces an Issue with full context attached.

## Clarifications

### Session 2026-04-28

- **Q1.** Assembly line on-disk format → A: Pure YAML (matches `task-types.yaml`, single source of truth, web-ui renders directly)
- **Q2.** Bot behavior on PRs outside the auto-merge path allowlist → A: Review-and-await-human (bot posts inline comments + verdict, PR sits open until a human merges; no time-based auto-merge fallback in v1)
- **Q3.** Authorization required to change `dark_factory.*` settings → A: Two-key — `enabled` toggle and `auto_merge.paths` changes require admin-scope token + CODEOWNERS approval recorded in audit log; lighter sub-settings (`notify`, `create_issue`, `review`) need only admin scope
- **Q4.** Concurrency control when two supervisors think they own the same task → A: DB row-level lease keyed on branch name; first action of any supervisor is `acquire_lease(branch_name)`; lease has a TTL that expires automatically for pod-death recovery
- **Q5.** Commit-trailer behavior in opt-out repos → A: Trailers always on regardless of `dark_factory.enabled` — strictly additive, single supervisor code path, pod-death recovery works uniformly across opt-in and opt-out repos

## Goals

1. **Cut handovers.** A successful implementation task should run
   from intent to merged PR in ≤ 1 supervised process per iteration,
   not 4+ ephemeral Job pods linked by CR / Issue / comment chains.
2. **Make pods restartable without loss.** A supervisor pod that
   dies mid-flow resumes from the last commit on the branch and loses
   no committed work.
3. **Stop the stale-PR graveyard.** Routine doc / spec / gap-fill PRs
   that pass green CI and bot review should not require human
   triage; they merge automatically on path-allowlist.
4. **Make Issues meaningful again.** A GitHub Issue in a Lore-managed
   repo should mean "a human is actually expected to do something."
   Today it means "a task happened" — which is noise.
5. **Preserve audit completeness.** Every action a Lore agent takes
   must remain traceable, even after Issues stop being the breadcrumb
   layer. Branch + PR + episode + audit_log replace Issue chatter.

## Non-Goals (this feature)

- The **Operation phase** of the BCG dark-factory model
  (auto-deployment, canary, auto-rollback, auto-incident-remediation).
  This is a follow-up feature.
- **Parallel red-team agents** (security-review, perf-review,
  spec-conformance, doc-coverage running concurrently). Today's single
  Haiku reviewer remains; fan-out is a follow-up.
- **Removal of the LoreTask CRD.** The CRD continues to spawn pods;
  what changes is that pod-internal phases use commits instead of CR
  status fields as the state machine. Eliminating the CRD entirely is
  out of scope.
- **Multi-provider model routing** (Fabro-style stylesheets). Lore
  remains Claude-Code-centric.

## User Personas

### Platform Engineer

Operates Lore. Needs visibility into autonomous flows: which tasks
ran dark, which auto-merged, which escalated. Configures per-repo
`dark_factory` settings and the global path-allowlist. Investigates
exceptions when they fire.

### Developer / Maintainer

Lives in a Lore-onboarded repo. Today receives ~10 bot Issue
notifications per week from routine gap-fill / spec-drift / runbook
tasks, most of which they ignore. After dark mode: receives Slack
or Issue notifications only when human action is genuinely needed.
Trust ramps up automatically as repo accumulates clean merges.

### Product Manager (non-engineer)

Submits feature intents via Slack `/lore feature-request`. Needs to
know "is my intent being worked on" and "where is the result." Today
they watch GitHub Issues; after dark mode they watch the web-ui
pipeline page. The web-ui already exists — this feature shifts PMs
to it as the canonical surface.

### Reviewer (human)

Today reviews bot-authored PRs (often 8 days late). After dark mode:
reviews only PRs that are *not* in the auto-merge allowlist (code
changes, infra changes, anything outside docs/specs/ADRs). Sees
fewer PRs, each carrying genuine human-decision weight.

## User Scenarios & Acceptance Criteria

### Scenario 1: Routine doc PR auto-merges

**Actor:** System (no human)

**Flow:**
1. Weekly gap-detection job identifies a missing runbook section.
2. Pipeline creates a `gap-fill` task. Repo has `dark_factory.enabled = true`.
3. No GitHub Issue is created for the task.
4. Supervisor process runs the gap-fill assembly line: draft → validate → commit → push → bot-review.
5. Each phase commits with `Lore-Stage:` trailer.
6. Bot review approves; CI is green; path is in `auto_merge.paths` (e.g. `runbooks/`); repo trust ≥ docs.
7. PR auto-merges.
8. Episode + curated memory are written. Audit log records the auto-merge with policy decision.

**Acceptance Criteria:**
- No GitHub Issue exists for this task at any point.
- The branch's commit log contains, in order, `[stage:draft]`, `[stage:validate]`, `[stage:review]`, `[stage:retrospective]` trailers.
- The PR body includes a `Lore-Task: <uuid>` line and a link to the policy that justified auto-merge.
- The audit log entry names the rule applied (path-allowlist, trust level, CI status, bot-approval).
- No human action occurs between push and merge: the PR merges automatically once CI is green (auto-merge engine SLA ≤ 60s per research R6), so wall-clock-to-merge is bounded by CI duration alone.

### Scenario 2: Implementation task survives pod death

**Actor:** System (no human)

**Flow:**
1. A `feature-request` produces an `implementation` task on a feature spec.
2. Supervisor pod starts, walks the graph: implement → validate → push → review.
3. After `[stage:implement]` and `[stage:validate]` commits land on the branch, the pod dies (preemption or OOM).
4. A replacement supervisor pod starts for the same task.
5. The replacement reads `git log` on the branch, sees the last `Lore-Stage:` is `validate`, resumes at the next graph node (`push`).
6. Task completes normally with full audit trail intact.

**Acceptance Criteria:**
- The replacement pod re-uses the existing branch (does not create a duplicate or rebase the history).
- No phase that was already committed is re-executed.
- The final PR carries the unbroken commit chain across both pods.
- `pipeline.tasks.status` and the branch state agree at termination — neither is the source of truth alone.

### Scenario 3: Code change still requires human review

**Actor:** Reviewer (human)

**Flow:**
1. A `general` task makes a non-trivial code change in `agent/src/`.
2. Path is *not* in `auto_merge.paths`; the dark-factory policy rejects auto-merge for this path.
3. Supervisor walks the graph normally and pushes commits with stage trailers.
4. PR opens, bot review runs, posts comments, marks `APPROVED` or `CHANGES_REQUESTED`.
5. PR remains open awaiting human review.
6. Human reviews and merges (or comments, triggering review-reactor on the same branch within the same supervised flow — no new CR, no new pod hand-off).

**Acceptance Criteria:**
- The PR exists and is *not* auto-merged.
- The bot review comments are present.
- If the human comments, the response is committed by the same supervisor process or a webhook-triggered continuation, and resumes from the branch state — not from a fresh CR / Job pair.
- Final merge is done by the human.

### Scenario 4: Approval gate produces an Issue

**Actor:** Approver (human), System

**Flow:**
1. Repo has `dark_factory.create_issue: on_gate` (the default when dark mode is on).
2. Task type has `approval_required: true` (e.g. infra change, sensitive repo).
3. System creates a GitHub Issue with full context, awaits the `approved` label.
4. No supervisor work begins until the label appears.
5. Human reviews the Issue and applies the label.
6. Supervisor begins, runs the graph normally to PR, follows the path-allowlist auto-merge rules from there.

**Acceptance Criteria:**
- An Issue exists, with the task description, links to relevant context, and a clear instruction on how to approve.
- No commits are made until the Issue is labeled.
- After approval, the flow proceeds without further human input until the next gate (or merge, if auto-merge applies).

### Scenario 5: Escalation produces an Issue with full context

**Actor:** Maintainer (human)

**Flow:**
1. An `implementation` task fails validation twice in a row.
2. Per existing policy, the supervisor marks the task `needs-human-help`.
3. With dark mode, no Issue existed at task start. On escalation, an Issue is created on the fly with: task description, the branch link, the failing validation output, the supervisor's diagnostic, and links to the contributing facts and memories.
4. Notification fires (Slack `escalation` channel).
5. Human picks up the Issue, fixes by hand or applies guidance, can resume the task or close.

**Acceptance Criteria:**
- The escalation Issue contains everything needed to act without re-deriving the context.
- The Issue links to the branch (which carries the partial work).
- A `escalation` notification reaches the configured Slack channel.
- The task can be resumed from the current commit if the human pushes a fix to the branch.

### Scenario 6: Repo opts out of dark mode

**Actor:** Platform Engineer

**Flow:**
1. A repo's settings have `dark_factory.enabled = false` (the migration default).
2. All flows behave exactly as today: Issue per task, status comments, no auto-merge, every PR awaits human review.

**Acceptance Criteria:**
- Repos with dark mode off see no behavior change from before this feature.
- Migration is non-destructive: enabling dark mode is a settings update, no schema migration required for opt-in repos.

### Scenario 7: PR-to-task cross-reference works without Issues

**Actor:** Auditor / Maintainer

**Flow:**
1. Looking at a PR (auto-merged or otherwise), a maintainer wants to find the originating task.
2. PR body contains `Lore-Task: <uuid>`.
3. Web-ui task page resolves the UUID to the full task record, branch, commit log with stage breakdown, and the curated retrospective.

**Acceptance Criteria:**
- Every Lore-authored PR has a `Lore-Task: <uuid>` in its body and on the final commit's trailer.
- Web-ui resolves the UUID in one click and displays branch + commits + episode side-by-side.
- The reverse direction (task page → PR) also resolves. ([validated by `TaskDetailView.test.tsx:125`](apps/web-ui/src/app/pipeline/[id]/TaskDetailView.test.tsx#L125))

## Functional Requirements

### FR1 — Branch-as-state checkpoints

- **FR1.1** Every workflow phase MUST end with a git commit containing a structured trailer block including at minimum `Lore-Stage:`, `Lore-Iteration:`, and `Lore-Task:`. Trailers are emitted unconditionally on every Lore-authored commit, regardless of the repo's `dark_factory.enabled` setting; they are the audit substrate for both dark-mode and opt-out repos. ([validated by `commit-trailers.test.ts:11`](libs/shared/src/commit-trailers.test.ts#L11); implemented by [`commit-trailers.ts:25`](libs/shared/src/commit-trailers.ts#L25))
- **FR1.2** *(restated 2026-07: DB-as-state)* The next assembly line node MUST be derivable from persisted state alone, without an in-memory walker: the event-driven walk replays `pipeline.assembly_line_nodes` through the definition (`nextTransition`, FR6.9). The original git-log resume described a fiction in production — the Floor's stage commits were local-only and never pushed. ([validated by `transition.test.ts:88`](libs/assembly-lines/src/transition.test.ts#L88); implemented by [`transition.ts:44`](libs/assembly-lines/src/transition.ts#L44))
- **FR1.3** Phases that produce no file changes (e.g. a no-op review) MUST still produce a commit (empty commit allowed) so the trailer is captured.
- **FR1.4** Branch history MUST NOT be rewritten by agents (no `--amend`, no force-push, no rebase) for any branch carrying stage trailers.
- **FR1.5** The `Lore-Task: <uuid>` trailer MUST also appear in the final PR body, replacing the today's `Refs #<issue>` cross-reference. ([validated by `pr-body.test.ts:11`](libs/shared/src/pr-body.test.ts#L11); implemented by [`pr-body.ts:10`](libs/shared/src/pr-body.ts#L10))
- **FR1.6** *(re-scoped 2026-07)* Concurrency control on the assembly-line path is structural — UNIQUE `(assembly_line_id, node_id, iteration)`, CAS node outcomes, first-writer-wins row finish, per-CR event dedupe (FR6.9) — plus a branch-keyed overlap guard: a second not-yet-started run on the same repo+branch finishes `lease_held`, deferring to the one in flight. There is no walker process left to lease. The branch-name lease backend (`lease-backends.ts`) and lease reaper remain for other consumers (the local runner's worktree mode). ([validated by `advance.test.ts:220`](apps/floor/src/jobs/assembly-line/advance.test.ts#L220); implemented by [`advance.ts:82`](apps/floor/src/jobs/assembly-line/advance.ts#L82))

### FR2 — Assembly line

- **FR2.1** Assembly line definitions MUST live as YAML files outside of TypeScript code, in a directory parallel to `scripts/task-types.yaml`. No alternate formats (DOT, JSON, custom DSL) are introduced; web-ui renders the graph from YAML directly. ([validated by `loader.test.ts:35`](libs/assembly-lines/src/loader.test.ts#L35); implemented by [`loader.ts:63`](libs/assembly-lines/src/loader.ts#L63))
- **FR2.2** An assembly line definition MUST express: nodes (typed: agent stage, validation, gate, retrospective), edges (with conditions on commit / CI / review outcomes), and entry/exit nodes. ([validated by `loader.test.ts:144`](libs/assembly-lines/src/loader.test.ts#L144); implemented by [`loader.ts:63`](libs/assembly-lines/src/loader.ts#L63))
- **FR2.3** *(restated 2026-07: shared definition, not shared executor)* The assembly line definition is a single source of truth: the same YAML (loader + builtin definitions) is consumed by both the Floor's event-driven walk (`nextTransition` over the parsed graph) and, aspirationally, the local runner. The in-process `executeAssemblyLine` that once interpreted it Floor-side is retired; there is no "GKE supervisor" process anymore. ([validated by `loader.test.ts:322`](libs/assembly-lines/src/loader.test.ts#L322); implemented by [`loader.ts:85`](libs/assembly-lines/src/loader.ts#L85), [`transition.ts:44`](libs/assembly-lines/src/transition.ts#L44))
- **FR2.4** Existing flows (implementation, gap-fill, runbook, review, feature-request, onboard, general) MUST be migratable to graph definitions without losing current behavior. ([validated by `loader.test.ts:226`](libs/assembly-lines/src/loader.test.ts#L226); implemented by [`loader.ts:96`](libs/assembly-lines/src/loader.ts#L96))
- **FR2.5** Adding a new flow MUST require only a new graph definition + any new agent prompts referenced by it; no changes to supervisor / runner code.

### FR3 — Opt-out human gates

- **FR3.1** Per-repo `settings.dark_factory.enabled` boolean (default `false` at migration time) MUST gate all dark-factory behavior changes. ([validated by `dark-factory-settings.test.ts:52`](apps/mcp-server/src/features/dark-factory/dark-factory-settings.test.ts#L52); implemented by [`dark-factory-settings.ts:63`](libs/shared/src/dark-factory-settings.ts#L63))
- **FR3.2** Sub-setting `create_issue` MUST support `never | on_gate | always`. Default when dark-mode-on: `on_gate`. ([validated by `dark-factory.test.ts:51`](apps/floor/src/adapters/dark-factory.test.ts#L51); implemented by [`dark-factory.ts:52`](apps/floor/src/adapters/dark-factory.ts#L52))
- **FR3.3** Sub-setting `auto_merge` MUST express path allowlist, minimum repo trust level, CI requirement, and bot-approval requirement. Default paths: `specs/`, `adrs/`, `*.md`, `CLAUDE.md`, `.claude/`. Default min trust: `docs`. ([validated by `pr-policy.test.ts:68`](apps/floor/src/adapters/pr-policy.test.ts#L68); implemented by [`auto-merge.ts:60`](apps/floor/src/application/jobs/auto-merge.ts#L60), [`path-match.ts:18`](libs/shared/src/path-match.ts#L18))
- **FR3.4** Sub-setting `review` MUST support `trust_based | always | never`. Default when dark-mode-on: `trust_based`. When `trust_based` is active and a PR's changed paths are *outside* the configured `auto_merge.paths` allowlist, the bot MUST post its inline review comments and verdict and then stop; the PR remains open awaiting human merge. Time-based "no-objection" auto-merge is explicitly out of scope for v1. ([validated by `dark-factory.test.ts:181`](apps/floor/src/adapters/dark-factory.test.ts#L181); implemented by [`dark-factory.ts:100`](apps/floor/src/adapters/dark-factory.ts#L100))
- **FR3.5** Sub-setting `notify` MUST support a list of channels: `escalation`, `watched`, `all`. Default when dark-mode-on: `[escalation]`. ([validated by `notify.test.ts:31`](libs/shared/src/project/notify/notify.test.ts#L31); implemented by [`notify-decision.ts:13`](libs/shared/src/project/notify/notify-decision.ts#L13))
- **FR3.6** Per-task overrides at creation time MUST be able to force `human_review: required`, `with_issue: true`, or `notify: completion` for a single task without changing repo settings.
- **FR3.7** Auto-merge decisions MUST be recorded in the audit log with the rule that justified them (path matched, trust level, CI status, bot-approval). ([validated by `audit.test.ts:6`](apps/floor/src/adapters/audit.test.ts#L6), [`auto-merge.test.ts:117`](apps/floor/src/application/jobs/auto-merge.test.ts#L117); implemented by [`auto-merge.ts:60`](apps/floor/src/application/jobs/auto-merge.ts#L60), [`audit.ts:9`](apps/floor/src/adapters/audit.ts#L9))
- **FR3.8** Issues created on escalation MUST contain: task description, branch link, failing phase output (if any), diagnostic from the supervisor, and links to contributing facts/memories. ([validated by `escalation.test.ts:35`](apps/floor/src/adapters/escalation.test.ts#L35); implemented by [`escalation.ts:65`](apps/floor/src/adapters/escalation.ts#L65))
- **FR3.9** Authorization on `dark_factory.*` settings MUST be tiered. Privileged changes — toggling `dark_factory.enabled` and modifying `dark_factory.auto_merge.paths` — MUST require both an admin-scope API token and a CODEOWNERS approval recorded in the audit log (a labeled PR against the settings, or an equivalent ceremony surfaced via the web-ui). Lighter sub-settings (`notify`, `create_issue`, `review`, `auto_merge.min_trust`, `auto_merge.require_*`) MAY be changed with admin scope alone. Every mutation, regardless of tier, MUST write an audit_log entry naming the actor, the previous value, the new value, and the authorization path used. ([validated by `dark-factory.test.ts:168`](apps/mcp-server/src/api/routes/dark-factory.test.ts#L168), [`dark-factory-settings.test.ts:85`](apps/mcp-server/src/features/dark-factory/dark-factory-settings.test.ts#L85); implemented by [`dark-factory-authz.ts:69`](apps/mcp-server/src/features/dark-factory/dark-factory-authz.ts#L69), [`dark-factory-settings.ts:63`](apps/mcp-server/src/features/dark-factory/dark-factory-settings.ts#L63))

### FR4 — Migration and compatibility

- **FR4.1** All existing repos MUST default to `dark_factory.enabled = false` at migration; behavior is identical to pre-feature.
- **FR4.2** Enabling dark mode on a repo MUST require no schema migration and no agent restart.
- **FR4.3** A repo can revert to `dark_factory.enabled = false` at any time; subsequent tasks behave as today.
- **FR4.4** Existing in-flight tasks at migration time MUST complete using their original flow; dark mode applies to tasks created after enablement.

### FR5 — Observability

- **FR5.1** OpenTelemetry traces MUST cover supervisor phase transitions; each phase produces a span linked to its commit SHA.
- **FR5.2** A repo dashboard view (web-ui) MUST surface: tasks run dark this week, tasks auto-merged, tasks escalated, current trust level, current `dark_factory` settings. ([validated by `RepoOverviewView.test.tsx:81`](apps/web-ui/src/app/repos/[owner]/[repo]/RepoOverviewView.test.tsx#L81))
- **FR5.3** The web-ui task detail page MUST resolve `Lore-Task: <uuid>` from a PR URL and render the branch's stage timeline. ([validated by `Timeline.test.tsx:149`](apps/web-ui/src/app/pipeline/[id]/Timeline.test.tsx#L149); implemented by [`Timeline.tsx:61`](apps/web-ui/src/app/pipeline/[id]/Timeline.tsx#L61), [`task-timeline.ts:62`](apps/mcp-server/src/api/routes/task-timeline.ts#L62))

### FR6 — Assembly line identity

- **FR6.1** Every assembly line execution MUST have a first-class per-attempt identity: a `pipeline.assembly_lines` row with a fresh uuid, distinct across retries and resumes of the same task. The task id remains stable across attempts; the assemblyLineId does not. ([validated by `assembly-lines.test.ts:225`](libs/shared/src/project/assembly-lines/assembly-lines.test.ts#L225); implemented by [`0025_assembly_lines.sql`](infra/terraform/modules/gke-mcp/lore-platform/charts/ui-helm/migrations/0025_assembly_lines.sql))
- **FR6.2** `project.assemblyLines.start(definitionName, opts)` MUST mint the assemblyLineId, persist the row (status `queued`), and insert the `assembly_line.start` event (source `internal`, dedupe key `assembly_line.start:<assemblyLineId>`, denormalized `repo` column) in one atomic statement, returning the id immediately — execution is picked up by the Floor event loop, never awaited by the caller. ([validated by `assembly-lines.test.ts:23`](libs/shared/src/project/assembly-lines/assembly-lines.test.ts#L23), [`project.test.ts:51`](libs/shared/src/project/lib/project.test.ts#L51); implemented by [`assembly-lines-pg.ts:19`](libs/shared/src/project/assembly-lines/assembly-lines-pg.ts#L19))
- **FR6.3** Every node execution MUST be associated with its assemblyLineId: a `pipeline.assembly_line_nodes` row records the node id, iteration, outcome, Agent CR name, and stage-commit sha. ([validated by `assembly-lines.test.ts:308`](libs/shared/src/project/assembly-lines/assembly-lines.test.ts#L308); implemented by [`assembly-lines-pg.ts:88`](libs/shared/src/project/assembly-lines/assembly-lines-pg.ts#L88))
- **FR6.4** *(re-scoped 2026-07)* Lore-authored commits (agent pods) carry the `Lore-Assembly-Line: <id>` trailer alongside `Lore-Task`; both are optional on parse (task-less lines omit `Lore-Task`). Floor-side stage commits retired with the in-process walk — the per-node record is the `pipeline.assembly_line_nodes` row (FR6.3), not a commit. ([validated by `commit-trailers.test.ts:68`](libs/shared/src/commit-trailers.test.ts#L68), [`commit-trailers.test.ts:78`](libs/shared/src/commit-trailers.test.ts#L78); implemented by [`commit-trailers.ts:34`](libs/shared/src/commit-trailers.ts#L34))
- **FR6.5** Agent CR names MUST key on the assemblyLineId, not the task id — `<assemblyLineId:8>-<nodeId>` — so two attempts of one task never collide on a CR. The CR spec keeps the `taskId` field (the watcher/reaper probe by task-id label). ([validated by `floor-assembly-line.test.ts:36`](apps/floor/src/jobs/assembly-line/floor-assembly-line.test.ts#L36); implemented by [`floor-assembly-line.ts:32`](apps/floor/src/jobs/assembly-line/floor-assembly-line.ts#L32))
- **FR6.6** *(restated 2026-07)* Every node execution — including back-edge re-iterations — MUST be recorded in `pipeline.assembly_line_nodes`: `ensureNodeStart` before the CR launches (with the CR name), `finishNodeOnce` at its terminal outcome. The rows ARE the walk state (FR6.9), not an observability side-channel. ([validated by `assembly-lines.test.ts:263`](libs/shared/src/project/assembly-lines/assembly-lines.test.ts#L263), [`advance.test.ts:87`](apps/floor/src/jobs/assembly-line/advance.test.ts#L87); implemented by [`assembly-lines-pg.ts:77`](libs/shared/src/project/assembly-lines/assembly-lines-pg.ts#L77), [`advance.ts:143`](apps/floor/src/jobs/assembly-line/advance.ts#L143))

- **FR6.7** *(rewritten 2026-07: event-driven walk)* The `assembly_line.start` handler MUST be the sole executor entry: it validates the definition (a task-less row with an unknown definition closes as failed and resolves — configuration errors never retry), marks the row running, and routes by definition shape (detect-shaped definitions to the repo-less detect runner; single-CR rows — task-backed, no builtin definition — mark running and return, per FR6.8; every other definition launches the ENTRY node's Agent CR and returns). It neither clones, nor supervises, nor backgrounds a walk — the walk advances per FR6.9, so a Floor restart loses nothing. A launch failure propagates so the event loop retries (the advance path is idempotent end to end). ([validated by `start-event-handler.test.ts:95`](apps/floor/src/jobs/assembly-line/start-event-handler.test.ts#L95), [`start-event-handler.test.ts:108`](apps/floor/src/jobs/assembly-line/start-event-handler.test.ts#L108), [`start-event-handler.test.ts:120`](apps/floor/src/jobs/assembly-line/start-event-handler.test.ts#L120), [`start-event-handler.test.ts:179`](apps/floor/src/jobs/assembly-line/start-event-handler.test.ts#L179); implemented by [`start-event-handler.ts:36`](apps/floor/src/jobs/assembly-line/start-event-handler.ts#L36), [`advance.ts:54`](apps/floor/src/jobs/assembly-line/advance.ts#L54))

- **FR6.8** Every Agent-CR task execution MUST have a run row — single-CR task types (onboard / review / runbook: no builtin assembly line) also create a `pipeline.assembly_lines` row at launch (`task_id` set, zero node rows), so the run table is the total execution history. The start handler marks such rows running without walking; the agent-watcher closes them from the task's post-handler status (`pr-created`/`review` → `pr_created`, `failed`/`needs-human-help` → `failed`, `completed` → `completed`) when the task's one CR goes terminal, falling back to the CR phase for an un-advanced task (a `Failed` CR whose task is still `running` closes `failed`, not `completed`). Token reclaim keys on the task type's routing, not on row existence. ([validated by `agent-cr-station-backend.test.ts:95`](apps/floor/src/jobs/station/agent-cr-station-backend.test.ts#L95), [`start-event-handler.test.ts:293`](apps/floor/src/jobs/assembly-line/start-event-handler.test.ts#L293), [`agent-watcher-logic.test.ts:87`](apps/floor/src/jobs/watcher/agent-watcher-logic.test.ts#L87); implemented by [`agent-cr-station-backend.ts:38`](apps/floor/src/jobs/station/agent-cr-station-backend.ts#L38), [`agent-watcher.ts:336`](apps/floor/src/jobs/watcher/agent-watcher.ts#L336))

- **FR6.9** The walk MUST be event-driven and idempotent: node CRs carry `lore.re-cinq.com/assembly-line-id` (full uuid) + `node-id` + `iteration` labels; their terminal phases produce `kubernetes.agent_node.{succeeded,failed}` events deduped PER CR (`k8s:<crName>:<phase>` — all node CRs of one line share the synthetic task-id label, so a task-keyed dedupe would swallow every node after the first). CR names embed the iteration (`<assemblyLineId:8>-<nodeId>-<iteration>`) so a revisited node runs a fresh pod rather than 409-reusing the prior iteration's terminal CR. The transition handler parses the outcome (LORE_NODE_RESULT → REVIEW_RESULT → phase precedence), records it via compare-and-set, and re-derives the next step purely from the persisted node rows (`nextTransition` replays the executor's exact edge/iteration_max routing). Duplicate and concurrent transitions MUST converge structurally: UNIQUE `(assembly_line_id, node_id, iteration)`, CAS node outcome, first-writer-wins row finish, 409-idempotent CR creates. The single-agent watcher path MUST never process labeled node CRs. ([validated by `k8s-map.test.ts:8`](apps/floor/src/listeners/k8s-map.test.ts#L8), [`node-event-handler.test.ts:88`](apps/floor/src/jobs/assembly-line/node-event-handler.test.ts#L88), [`advance.test.ts:94`](apps/floor/src/jobs/assembly-line/advance.test.ts#L94), [`transition.test.ts:235`](libs/assembly-lines/src/transition.test.ts#L235); implemented by [`advance.ts:54`](apps/floor/src/jobs/assembly-line/advance.ts#L54), [`node-event-handler.ts:24`](apps/floor/src/jobs/assembly-line/node-event-handler.ts#L24), [`k8s-map.ts:37`](apps/floor/src/listeners/k8s-map.ts#L37))

- **FR6.10** A per-minute reaper (`cron.assembly_line_reaper.tick`) MUST converge every open line — it is the ONLY recovery for a dead-lettered transition (dedupe rows make reconcile re-emits permanent no-ops): an open node whose CR is terminal resolves its real outcome; a rowed-but-unlaunched node relaunches (409 no-op if the CR exists); a node past `timeout_minutes` (+2 min buffer, default 62) fails as a timeout and transitions; a row queued >30 min fails with a reason; a running row with no open node re-advances (the replay converges); a single-CR (definition-less) row whose backing task is terminal is closed from that task's status. Every open line either progresses or terminally fails — bounded. ([validated by `assembly-line-reaper.test.ts:38`](apps/floor/src/jobs/assembly-line/assembly-line-reaper.test.ts#L38), [`assembly-line-reaper.test.ts:124`](apps/floor/src/jobs/assembly-line/assembly-line-reaper.test.ts#L124); implemented by [`assembly-line-reaper.ts:76`](apps/floor/src/jobs/assembly-line/assembly-line-reaper.ts#L76))

## Requirement Traceability

Each functional requirement maps to the user scenario(s) that exercise it and the
success criteria it advances. Per-statement test and implementation links live
inline on each FR above (`validated by` / `implemented by`).

| Requirement | Scenario(s) | Success criteria |
|---|---|---|
| FR1.1 Trailers on every commit | 1, 6 | SC5 |
| FR1.2 Next node from git log alone | 2 | SC2 |
| FR1.3 Empty commit for no-op phases | 1 | SC5 |
| FR1.4 No history rewrite | 2 | SC2, SC5 |
| FR1.5 `Lore-Task:` in PR body | 7 | SC5 |
| FR1.6 Branch-name lease | 2 | SC2 |
| FR2.1 Workflow YAML (no alt formats) | 1, 3 | SC1 |
| FR2.2 Node/edge model | 1, 3 | SC1 |
| FR2.3 Same definition local + GKE | 1, 2, 3 | SC1 |
| FR2.4 Migrate existing flows | 6 | SC1 |
| FR2.5 New flow = new graph only | — | SC1 |
| FR3.1 `enabled` gate | 6 | SC4 |
| FR3.2 `create_issue` | 1, 4 | SC4 |
| FR3.3 `auto_merge` allowlist + trust | 1, 3 | SC3, SC6, SC7 |
| FR3.4 `review` gate | 3 | SC6 |
| FR3.5 `notify` channels | 5 | SC4 |
| FR3.6 Per-task overrides | 4 | — |
| FR3.7 Auto-merge audit record | 1, 3 | SC5, SC7 |
| FR3.8 Escalation Issue content | 5 | SC4 |
| FR3.9 Two-key settings authz | (settings change) | SC7 |
| FR4.1–4.4 Migration & compatibility | 6 | SC8 |
| FR5.1 OTEL phase spans | 2 | SC2 |
| FR5.2 Repo dashboard | 7 | — |
| FR5.3 Timeline + `Lore-Task:` resolver | 7 | SC5 |

## Success Criteria

### SC1 — Handover reduction
For implementation tasks, **the count of distinct ephemeral Job pods per task drops from ≥ 4 to ≤ 2** (one supervisor + at most one webhook-triggered continuation), measured over a 7-day window after dark mode is enabled on a representative repo.

### SC2 — Pod-death survivability
*(restated 2026-07)* **A Floor pod dying at ANY point leaves no assembly line stranded**: there is no walker process — transitions are event-driven over persisted node rows (FR6.9), so already-recorded nodes are never re-executed, in-flight Agent CRs keep running and their terminal events (or the FR6.10 reaper) advance the line on the next Floor instance. Measured by `kubectl rollout restart` during canary runs across all node types.

### SC3 — Stale-PR elimination
On dark-mode-enabled repos, **no PR auto-generated by Lore stays open with green CI + bot-approved status for more than 24 hours**, measured over a rolling 30-day window.

### SC4 — Human notification reduction
For a representative onboarded repo, **the number of GitHub Issues created by Lore drops by at least 80%** when comparing the 30-day post-enable window against the 30-day pre-enable baseline (captured in `pipeline.dark_factory_baseline` per T011b), while task throughput stays equal or higher ([validated by `dark-factory-baseline.test.ts:22`](apps/floor/src/application/jobs/dark-factory-baseline.test.ts#L22)).

### SC5 — Audit completeness preserved
**100% of Lore-authored merged PRs are resolvable to their originating task via the `Lore-Task:` trailer**, with the branch's commit log reconstructing the full phase sequence and outcomes.

### SC6 — Human review focus
For dark-mode-enabled repos, **the share of bot-authored PRs that require human review drops to ≤ 30%** of the dark-mode total, with the remainder auto-merging on policy.

### SC7 — Trust-based gating works
**Zero auto-merges occur outside the configured path allowlist** during the first 90 days post-launch. Any violation is treated as a P1 incident.

### SC8 — Adoption gate
At least **three repos representing distinct trust tiers (`docs`, `tests`, `implementation`)** must be running dark mode for ≥ 14 days each before the feature can be declared general-availability.

## Key Entities

### Assembly Line Graph
A declarative description of a flow as nodes and edges. Stored in `assembly-lines/*.yaml` (or equivalent) and loaded by both the local runner and the GKE supervisor. ([implemented by `loader.ts:63`](libs/assembly-lines/src/loader.ts#L63))

### Stage Commit
A git commit produced at the end of an assembly line phase. Carries trailers identifying the stage, iteration, and originating task. The commit is the durable handover unit between phases. ([implemented by `commit-trailers.ts:25`](libs/shared/src/commit-trailers.ts#L25))

### Dark-Factory Policy
The merged result of the per-repo `settings.dark_factory.*` block plus per-task overrides. Determines: whether to create an Issue, whether to auto-merge on success, who to notify, and how strict the review gate is. ([implemented by `dark-factory-settings.ts:63`](libs/shared/src/dark-factory-settings.ts#L63))

### Auto-Merge Decision Record
An audit-log entry capturing every auto-merge: the PR, the task, the policy that applied, the trust level at decision time, the CI status, and the bot-review verdict. Required for forensic reconstruction. ([implemented by `auto-merge.ts:60`](apps/floor/src/application/jobs/auto-merge.ts#L60), [`audit.ts:9`](apps/floor/src/adapters/audit.ts#L9))

### Escalation Issue
A GitHub Issue created on the fly when a task hits `needs-human-help`. Differs from today's per-task Issue in that it carries diagnostic context and links to partial work; humans can act on it without re-deriving state. ([implemented by `escalation.ts:65`](apps/floor/src/adapters/escalation.ts#L65))

## Constitutional Impact

This feature **partially supersedes** the row "Task tracking | Pipeline tasks via Lore MCP + GH Issues" in Principle 7 of the constitution. Per the amendment procedure, this requires:

- An ADR superseding the task-tracking decision row, documenting the alternatives rejected (keep Issues mandatory; remove Issues entirely; the chosen middle path of opt-in-per-repo).
- A constitution patch (MINOR version bump) updating the row to "Task tracking | Pipeline tasks via Lore MCP; GH Issues for exception surfaces (opt-out)".

All other principles remain intact. Specifically preserved:
- **P4 Three-Command Developer Interface** — no new commands.
- **P5 Single Interface (Lore MCP)** — no change to MCP surface.
- **P9 Intelligent Agents Over Mechanical Scripts** — strengthened (supervisor agents now own end-to-end flows).
- **P11 Intelligent Memory Lifecycle** — unchanged.

## Assumptions

- The progressive-trust system (`docs → tests → implementation → full`) accurately reflects per-repo readiness and is the right input to auto-merge gating.
- GitHub does not impose API rate limits that make on-the-fly escalation Issue creation unreliable. (Mitigation: Issue creation already used elsewhere; rate limits are familiar.)
- Branch-as-state implies branches are not rebased by humans either while a task is in flight. (Mitigation: branches are agent-owned per task; humans rebase only after the task is closed.)
- Web-ui pipeline page is acceptable as the canonical "where's my task" surface for non-engineer stakeholders. PMs already have access.
- Supervisor pods can be configured to read git history at startup with minimal overhead (≤ 5 seconds).

## Dependencies

- The progressive-trust system (`settings.trust.level`) — already shipped.
- The audit_log infrastructure — already shipped.
- The web-ui pipeline page and task detail view — already shipped; this feature adds rendering for stage timelines and the `Lore-Task:` resolver.
- The OpenTelemetry instrumentation — already shipped; this feature adds new span types.
- GitHub App permissions for auto-merge — currently the App can comment and create PRs; merge permissions need verification at plan time.
