# Feature Specification: Dark Factory Mode

> **Execution substrate moved (ADR-031, `specs/floor-on-ai-subsystem/`).** Dark Factory's
> policy (issue suppression, auto-merge, branch-as-state, audit) is unchanged, but the
> tasks it governs now run on the ai-agent-subsystem's `Agent` CRs, not `LoreTask` CRs —
> read the `LoreTask`-specific mechanics here in the past tense.

| Field    | Value                          |
|----------|--------------------------------|
| Feature  | Dark Factory Mode              |
| Branch   | 6-dark-factory                 |
| Status   | In Progress                    |
| Created  | 2026-04-28                     |
| Owner    | Platform Engineering           |

Dark Factory mode trims the pipeline's per-task artifact chatter — GitHub Issues, status comments, Slack messages, bot reviews — down to the few durable artifacts (the branch, the merged PR, the curated episode), suppressing issues and auto-merging low-risk changes so humans are not buried in watch-me-work theater.

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
- The reverse direction (task page → PR) also resolves. ([validated by `TaskDetailView.test.tsx:206`](apps/web-ui/src/app/tasks/[id]/TaskDetailView.test.tsx#L206))

## Functional Requirements

### FR1 — Branch-as-state checkpoints

- **FR1.1** Every workflow phase MUST end with a git commit containing a structured trailer block including at minimum `Lore-Stage:`, `Lore-Iteration:`, and `Lore-Task:`. Trailers are emitted unconditionally on every Lore-authored commit, regardless of the repo's `dark_factory.enabled` setting; they are the audit substrate for both dark-mode and opt-out repos. ([validated by `commit-trailers.test.ts:11`](libs/shared/src/commit-trailers.test.ts#L11), [`commit-trailers.test.ts:23`](libs/shared/src/commit-trailers.test.ts#L23); implemented by [`commit-trailers.ts:25`](libs/shared/src/commit-trailers.ts#L25))
- **FR1.1a** The structured trailer block MUST be machine-readable: `parseTrailers` round-trips a formatted block with or without extras, reads a trailer paragraph appended to a multi-paragraph commit body, tolerates CRLF line endings and trailing whitespace, and returns null when no trailer paragraph is present, a required key is missing, `Lore-Iteration` is non-numeric, the final paragraph mixes trailer and non-trailer lines, or the input is empty. ([validated by `commit-trailers.test.ts:84`](libs/shared/src/commit-trailers.test.ts#L84), [`commit-trailers.test.ts:129`](libs/shared/src/commit-trailers.test.ts#L129), [`commit-trailers.test.ts:184`](libs/shared/src/commit-trailers.test.ts#L184), [`commit-trailers.test.ts:216`](libs/shared/src/commit-trailers.test.ts#L216), [`commit-trailers.test.ts:140`](libs/shared/src/commit-trailers.test.ts#L140), [`commit-trailers.test.ts:195`](libs/shared/src/commit-trailers.test.ts#L195), [`commit-trailers.test.ts:206`](libs/shared/src/commit-trailers.test.ts#L206), [`commit-trailers.test.ts:158`](libs/shared/src/commit-trailers.test.ts#L158), [`commit-trailers.test.ts:162`](libs/shared/src/commit-trailers.test.ts#L162), [`commit-trailers.test.ts:166`](libs/shared/src/commit-trailers.test.ts#L166), [`commit-trailers.test.ts:172`](libs/shared/src/commit-trailers.test.ts#L172), [`commit-trailers.test.ts:179`](libs/shared/src/commit-trailers.test.ts#L179); implemented by [`commit-trailers.ts:25`](libs/shared/src/commit-trailers.ts#L25))
- **FR1.1b** The commit-trailers module also carries a spec→test provenance trailer: `formatValidatesTrailer` renders a `ProvenanceRef` as `Lore-Validates: <specPath>#<ordinal> -> <target>`, and `parseValidatesTrailers` reads each `Lore-Validates` line back into a `ProvenanceRef` with a numeric ordinal, round-tripping format→parse. ([validated by returns one ref with numeric ordinal for a single Lore-Validates line](libs/shared/src/commit-trailers.test.ts#L227), [renders specs/foo/spec.md#7 -> test/x.test.ts and round-trips through parseValidatesTrailers](libs/shared/src/commit-trailers.test.ts#L242); implemented by [`commit-trailers.ts`](libs/shared/src/commit-trailers.ts))
- **FR1.2** *(restated 2026-07: DB-as-state)* The next assembly line node MUST be derivable from persisted state alone, without an in-memory walker: the event-driven walk replays `pipeline.assembly_line_nodes` through the definition (`nextTransition`, FR6.9). The original git-log resume described a fiction in production — the Floor's stage commits were local-only and never pushed. ([validated by `transition.test.ts:97`](libs/assembly-lines/src/transition.test.ts#L97), [`transition.test.ts:72`](libs/assembly-lines/src/transition.test.ts#L72), [`transition.test.ts:77`](libs/assembly-lines/src/transition.test.ts#L77), [`transition.test.ts:83`](libs/assembly-lines/src/transition.test.ts#L83), [`transition.test.ts:91`](libs/assembly-lines/src/transition.test.ts#L91), [`transition.test.ts:103`](libs/assembly-lines/src/transition.test.ts#L103), [`transition.test.ts:117`](libs/assembly-lines/src/transition.test.ts#L117), [`transition.test.ts:127`](libs/assembly-lines/src/transition.test.ts#L127), [`transition.test.ts:144`](libs/assembly-lines/src/transition.test.ts#L144), [`transition.test.ts:156`](libs/assembly-lines/src/transition.test.ts#L156), [`transition.test.ts:165`](libs/assembly-lines/src/transition.test.ts#L165), [`transition.test.ts:190`](libs/assembly-lines/src/transition.test.ts#L190); implemented by [`transition.ts:44`](libs/assembly-lines/src/transition.ts#L44))
- **FR1.3** Phases that produce no file changes (e.g. a no-op review) MUST still produce a commit (empty commit allowed) so the trailer is captured.
- **FR1.4** Branch history MUST NOT be rewritten by agents (no `--amend`, no force-push, no rebase) for any branch carrying stage trailers.
- **FR1.5** The `Lore-Task: <uuid>` trailer MUST also appear in the final PR body, replacing the today's `Refs #<issue>` cross-reference. `prFooter` emits `Refs #N` before `Lore-Task` only when an issue number is present, treating a null, undefined, or `0` issue number as no issue. ([validated by `pr-body.test.ts:11`](libs/shared/src/pr-body.test.ts#L11), [`pr-body.test.ts:5`](libs/shared/src/pr-body.test.ts#L5), [`pr-body.test.ts:17`](libs/shared/src/pr-body.test.ts#L17), [`pr-body.test.ts:21`](libs/shared/src/pr-body.test.ts#L21); implemented by [`pr-body.ts:10`](libs/shared/src/pr-body.ts#L10))
- **FR1.6** *(re-scoped 2026-07)* Concurrency control on the assembly-line path is structural — UNIQUE `(assembly_line_id, node_id, iteration)`, CAS node outcomes, first-writer-wins row finish, per-CR event dedupe (FR6.9) — plus a branch-keyed overlap guard: a second not-yet-started run on the same repo+branch finishes `lease_held`, deferring to the one in flight. There is no walker process left to lease. The branch-name lease backend (`lease-backends.ts`) and lease reaper remain for other consumers (the local runner's worktree mode); the reaper writes one `lease_expired` audit entry per reaped lease (branch name + previous holder, expiry ISO-stringified from a Date and passed through as a string), reporting the reaped count and writing nothing when none are past the grace cutoff. ([validated by `advance.test.ts:291`](apps/floor/src/jobs/assembly-line/advance.test.ts#L296), [`lease-reaper.test.ts:23`](apps/floor/src/main-loop/lease/lease-reaper.test.ts#L23), [`lease-reaper.test.ts:47`](apps/floor/src/main-loop/lease/lease-reaper.test.ts#L47), [`lease-reaper.test.ts:55`](apps/floor/src/main-loop/lease/lease-reaper.test.ts#L55), [`lease-reaper.test.ts:67`](apps/floor/src/main-loop/lease/lease-reaper.test.ts#L67); implemented by [`advance.ts:82`](apps/floor/src/jobs/assembly-line/advance.ts#L82))
- **FR1.6a** The branch-keyed lease backend (Db + File + in-memory double) MUST implement one contract: `acquire` returns `acquired:true` on an empty slot or after a prior lease has expired (reporting `tookOverFrom` on takeover) and `acquired:false` with the current holder while a lease is still valid; a default TTL of 600s applies when unspecified; `refresh` extends the expiry only for the current holder (false for a non-holder or a missing record) and preserves the existing phase via COALESCE when the phase is omitted; `release` removes the record only for the holder (false, record intact, otherwise); `reapExpired(cutoff)` deletes and returns only leases past the cutoff (empty array otherwise); branch names containing slashes are encoded correctly. ([validated by `lease-backends.test.ts:35`](libs/shared/src/project/leases/lease-backends.test.ts#L35), [`lease-backends.test.ts:53`](libs/shared/src/project/leases/lease-backends.test.ts#L53), [`lease-backends.test.ts:66`](libs/shared/src/project/leases/lease-backends.test.ts#L66), [`lease-backends.test.ts:82`](libs/shared/src/project/leases/lease-backends.test.ts#L82), [`lease-backends.test.ts:93`](libs/shared/src/project/leases/lease-backends.test.ts#L93), [`lease-backends.test.ts:108`](libs/shared/src/project/leases/lease-backends.test.ts#L108), [`lease-backends.test.ts:115`](libs/shared/src/project/leases/lease-backends.test.ts#L115), [`lease-backends.test.ts:125`](libs/shared/src/project/leases/lease-backends.test.ts#L125), [`lease-backends.test.ts:134`](libs/shared/src/project/leases/lease-backends.test.ts#L134), [`lease-backends.test.ts:143`](libs/shared/src/project/leases/lease-backends.test.ts#L143), [`lease-backends.test.ts:163`](libs/shared/src/project/leases/lease-backends.test.ts#L163), [`lease-backends.test.ts:187`](libs/shared/src/project/leases/lease-backends.test.ts#L187), [`lease-backends.test.ts:202`](libs/shared/src/project/leases/lease-backends.test.ts#L202), [`lease-backends.test.ts:211`](libs/shared/src/project/leases/lease-backends.test.ts#L211), [`lease-backends.test.ts:220`](libs/shared/src/project/leases/lease-backends.test.ts#L220), [`lease-backends.test.ts:229`](libs/shared/src/project/leases/lease-backends.test.ts#L229), [`lease-backends.test.ts:238`](libs/shared/src/project/leases/lease-backends.test.ts#L238), [`lease-backends.test.ts:244`](libs/shared/src/project/leases/lease-backends.test.ts#L244), [`lease-backends.test.ts:255`](libs/shared/src/project/leases/lease-backends.test.ts#L255), [`lease-backends.test.ts:265`](libs/shared/src/project/leases/lease-backends.test.ts#L265), [`lease-backends.test.ts:279`](libs/shared/src/project/leases/lease-backends.test.ts#L279), [`lease-backends.test.ts:301`](libs/shared/src/project/leases/lease-backends.test.ts#L301), [`lease-backends.test.ts:313`](libs/shared/src/project/leases/lease-backends.test.ts#L313); implemented by [`lease-backends.ts`](libs/shared/src/project/leases/lease-backends.ts))

### FR2 — Assembly line

- **FR2.1** Assembly line definitions MUST live as YAML files outside of TypeScript code, in a directory parallel to `scripts/task-types.yaml`. No alternate formats (DOT, JSON, custom DSL) are introduced; web-ui renders the graph from YAML directly. ([validated by `loader.test.ts:35`](libs/assembly-lines/src/loader.test.ts#L35), [`loader.test.ts:44`](libs/assembly-lines/src/loader.test.ts#L44), [`loader.test.ts:50`](libs/assembly-lines/src/loader.test.ts#L50), [`loader.test.ts:66`](libs/assembly-lines/src/loader.test.ts#L66), [`loader.test.ts:82`](libs/assembly-lines/src/loader.test.ts#L82), [`loader.test.ts:101`](libs/assembly-lines/src/loader.test.ts#L101), [`loader.test.ts:124`](libs/assembly-lines/src/loader.test.ts#L124), [`loader.test.ts:296`](libs/assembly-lines/src/loader.test.ts#L319); implemented by [`loader.ts:63`](libs/assembly-lines/src/loader.ts#L63))
- **FR2.2** An assembly line definition MUST express: nodes (typed: agent stage, validation, gate, retrospective), edges (with conditions on commit / CI / review outcomes), and entry/exit nodes. ([validated by `loader.test.ts:145`](libs/assembly-lines/src/loader.test.ts#L145), [`loader.test.ts:174`](libs/assembly-lines/src/loader.test.ts#L174), [`loader.test.ts:206`](libs/assembly-lines/src/loader.test.ts#L206), [`loader.test.ts:258`](libs/assembly-lines/src/loader.test.ts#L281), [`loader.test.ts:275`](libs/assembly-lines/src/loader.test.ts#L298); implemented by [`loader.ts:63`](libs/assembly-lines/src/loader.ts#L63))
- **FR2.3** *(restated 2026-07: shared definition, not shared executor)* The assembly line definition is a single source of truth: the same YAML (loader + builtin definitions) is consumed by both the Floor's event-driven walk (`nextTransition` over the parsed graph) and, aspirationally, the local runner. The in-process `executeAssemblyLine` that once interpreted it Floor-side is retired; there is no "GKE supervisor" process anymore. ([validated by `loader.test.ts:322`](libs/assembly-lines/src/loader.test.ts#L345), [`boundaries.test.ts:41`](libs/assembly-lines/src/boundaries.test.ts#L41), [`boundaries.test.ts:45`](libs/assembly-lines/src/boundaries.test.ts#L45), [`boundaries.test.ts:49`](libs/assembly-lines/src/boundaries.test.ts#L49); implemented by [`loader.ts:85`](libs/assembly-lines/src/loader.ts#L85), [`transition.ts:44`](libs/assembly-lines/src/transition.ts#L44))
- **FR2.4** Existing flows (implementation, gap-fill, runbook, review, feature-request, onboard, general) MUST be migratable to graph definitions without losing current behavior. ([validated by `loader.test.ts:389`](libs/assembly-lines/src/loader.test.ts#L414), [`loader.test.ts:340`](libs/assembly-lines/src/loader.test.ts#L366), [`loader.test.ts:359`](libs/assembly-lines/src/loader.test.ts#L383), [`loader.test.ts:380`](libs/assembly-lines/src/loader.test.ts#L393), [`loader.test.ts:400`](libs/assembly-lines/src/loader.test.ts#L423), [`loader.test.ts:413`](libs/assembly-lines/src/loader.test.ts#L434); implemented by [`loader.ts:96`](libs/assembly-lines/src/loader.ts#L96))
- **FR2.5** Adding a new flow MUST require only a new graph definition + any new agent prompts referenced by it; no changes to supervisor / runner code.
- **FR2.6** Non-agent node types MUST execute deterministically through a command relay: the relay runs a command in the configured workdir and returns its stdout, stderr and exit code, running sequential commands in order on the same relay; the `validate` node runs the repo's detected lint/typecheck check through the relay — success when no tooling is detected or the check passes, `failed` naming the failing step otherwise; the `github_action` node maps each CI conclusion to a node outcome. ([validated by `relay-executor.test.ts:50`](libs/assembly-lines/src/relay/relay-executor.test.ts#L50), [`relay-executor.test.ts:60`](libs/assembly-lines/src/relay/relay-executor.test.ts#L60), [`relay-executor.test.ts:68`](libs/assembly-lines/src/relay/relay-executor.test.ts#L68), [`relay-executor.test.ts:76`](libs/assembly-lines/src/relay/relay-executor.test.ts#L76), [`validate-handler.test.ts:51`](libs/assembly-lines/src/validate-handler.test.ts#L51), [`validate-handler.test.ts:59`](libs/assembly-lines/src/validate-handler.test.ts#L59), [`validate-handler.test.ts:67`](libs/assembly-lines/src/validate-handler.test.ts#L67), [`validate-handler.test.ts:89`](libs/assembly-lines/src/validate-handler.test.ts#L89), [`github-action-handler.test.ts:5`](libs/assembly-lines/src/github-action-handler.test.ts#L5))

### FR3 — Opt-out human gates

- **FR3.1** Per-repo `settings.dark_factory.enabled` boolean (default `false` at migration time) MUST gate all dark-factory behavior changes. ([validated by `dark-factory-settings.test.ts:72`](apps/lore-api/src/features/dark-factory/dark-factory-settings.test.ts#L72), [`dark-factory-settings.test.ts:81`](apps/lore-api/src/features/dark-factory/dark-factory-settings.test.ts#L81), [`dark-factory-settings.test.ts:92`](apps/lore-api/src/features/dark-factory/dark-factory-settings.test.ts#L92), [`dark-factory-resolve.test.ts:8`](apps/web-ui/src/lib/dark-factory-resolve.test.ts#L8), [`dark-factory-resolve.test.ts:17`](apps/web-ui/src/lib/dark-factory-resolve.test.ts#L17), [`dark-factory-resolve.test.ts:29`](apps/web-ui/src/lib/dark-factory-resolve.test.ts#L29), [`dark-factory-resolve.test.ts:5`](apps/floor/src/jobs/dark-factory/dark-factory-resolve.test.ts#L5), [`dark-factory-resolve.test.ts:14`](apps/floor/src/jobs/dark-factory/dark-factory-resolve.test.ts#L14), [`dark-factory-resolve.test.ts:20`](apps/floor/src/jobs/dark-factory/dark-factory-resolve.test.ts#L20), [`dark-factory-resolve.test.ts:32`](apps/floor/src/jobs/dark-factory/dark-factory-resolve.test.ts#L32), [`dark-factory-resolve.test.ts:46`](apps/floor/src/jobs/dark-factory/dark-factory-resolve.test.ts#L46), [`settings-pg.test.ts:42`](libs/shared/src/project/settings/settings-pg.test.ts#L42), [`settings-pg.test.ts:55`](libs/shared/src/project/settings/settings-pg.test.ts#L55), [`settings-pg.test.ts:63`](libs/shared/src/project/settings/settings-pg.test.ts#L63), [`settings-pg.test.ts:69`](libs/shared/src/project/settings/settings-pg.test.ts#L69); implemented by [`dark-factory-settings.ts:63`](libs/shared/src/dark-factory-settings.ts#L63))
- **FR3.1a** The `dark_factory` settings schema MUST validate input: it accepts an empty patch and a complete settings doc, and rejects unknown `create_issue` values, unknown trust levels, and more than 32 `auto_merge.paths`. ([validated by `dark-factory-settings.test.ts:11`](apps/lore-api/src/features/dark-factory/dark-factory-settings.test.ts#L11), [`dark-factory-settings.test.ts:15`](apps/lore-api/src/features/dark-factory/dark-factory-settings.test.ts#L15), [`dark-factory-settings.test.ts:32`](apps/lore-api/src/features/dark-factory/dark-factory-settings.test.ts#L32), [`dark-factory-settings.test.ts:38`](apps/lore-api/src/features/dark-factory/dark-factory-settings.test.ts#L38), [`dark-factory-settings.test.ts:44`](apps/lore-api/src/features/dark-factory/dark-factory-settings.test.ts#L44))
- **FR3.1b** The settings persistence port MUST resolve a repo's settings through the real resolver, read and overwrite the raw settings JSONB bound to the repo, bind the repo when setting a GitHub variable (delegating the write to the repo-config writer), and list only onboarded repos with their ingest stamp. ([validated by `settings.test.ts:13`](libs/shared/src/project/settings/settings.test.ts#L13), [`settings.test.ts:27`](libs/shared/src/project/settings/settings.test.ts#L27), [`settings.test.ts:38`](libs/shared/src/project/settings/settings.test.ts#L38), [`settings.test.ts:55`](libs/shared/src/project/settings/settings.test.ts#L55), [`settings-pg.test.ts:80`](libs/shared/src/project/settings/settings-pg.test.ts#L80))
- **FR3.2** Sub-setting `create_issue` MUST support `never | on_gate | always`. Default when dark-mode-on: `on_gate`. ([validated by `dark-factory.test.ts:51`](apps/floor/src/jobs/dark-factory/dark-factory.test.ts#L51), [`dark-factory.test.ts:11`](apps/floor/src/jobs/dark-factory/dark-factory.test.ts#L11), [`dark-factory.test.ts:21`](apps/floor/src/jobs/dark-factory/dark-factory.test.ts#L21), [`dark-factory.test.ts:31`](apps/floor/src/jobs/dark-factory/dark-factory.test.ts#L31), [`dark-factory.test.ts:41`](apps/floor/src/jobs/dark-factory/dark-factory.test.ts#L41), [`dark-factory.test.ts:61`](apps/floor/src/jobs/dark-factory/dark-factory.test.ts#L61), [`dark-factory.test.ts:71`](apps/floor/src/jobs/dark-factory/dark-factory.test.ts#L71), [`dark-factory.test.ts:94`](apps/floor/src/jobs/dark-factory/dark-factory.test.ts#L94); implemented by [`dark-factory.ts:52`](apps/floor/src/adapters/dark-factory.ts#L52))
- **FR3.3** Sub-setting `auto_merge` MUST express path allowlist, minimum repo trust level, CI requirement, and bot-approval requirement. Default paths: `specs/`, `adrs/`, `*.md`, `CLAUDE.md`, `.claude/`. Default min trust: `docs`. ([validated by `pr-policy.test.ts:102`](apps/floor/src/jobs/platform/pr-policy.test.ts#L102), [`pr-policy.test.ts:92`](apps/floor/src/jobs/platform/pr-policy.test.ts#L92), [`pr-policy.test.ts:129`](apps/floor/src/jobs/platform/pr-policy.test.ts#L129), [`pr-policy.test.ts:141`](apps/floor/src/jobs/platform/pr-policy.test.ts#L141), [`pr-policy.test.ts:151`](apps/floor/src/jobs/platform/pr-policy.test.ts#L151), [`pr-policy.test.ts:166`](apps/floor/src/jobs/platform/pr-policy.test.ts#L166), [`pr-policy.test.ts:178`](apps/floor/src/jobs/platform/pr-policy.test.ts#L178), [`pr-policy.test.ts:190`](apps/floor/src/jobs/platform/pr-policy.test.ts#L190), [`pr-policy.test.ts:202`](apps/floor/src/jobs/platform/pr-policy.test.ts#L202); implemented by [`auto-merge.ts:60`](apps/floor/src/application/jobs/auto-merge.ts#L60), [`path-match.ts:18`](libs/shared/src/path-match.ts#L18))
- **FR3.3a** The `auto_merge.paths` gate is all-or-nothing: `allPathsMatch()` admits a PR only when **every** changed path matches at least one allowlist glob — a single non-matching path in a mixed PR rejects auto-merge. Matching covers dotfile prefixes (`.claude/rules/`) and deep `specs/**` nesting, treats an empty changed-set as vacuously allowed, and treats an empty allowlist as matching nothing; the companion pattern-lister names every glob a path matched for the audit rule trace (FR3.7). ([validated by `path-match.test.ts:13`](libs/shared/src/path-match.test.ts#L13), [`path-match.test.ts:22`](libs/shared/src/path-match.test.ts#L22), [`path-match.test.ts:31`](libs/shared/src/path-match.test.ts#L31), [`path-match.test.ts:40`](libs/shared/src/path-match.test.ts#L40), [`path-match.test.ts:44`](libs/shared/src/path-match.test.ts#L44), [`path-match.test.ts:48`](libs/shared/src/path-match.test.ts#L48), [`path-match.test.ts:54`](libs/shared/src/path-match.test.ts#L54), [`path-match.test.ts:59`](libs/shared/src/path-match.test.ts#L59), [`path-match.test.ts:67`](libs/shared/src/path-match.test.ts#L67), [`path-match.test.ts:74`](libs/shared/src/path-match.test.ts#L74); implemented by [`path-match.ts:18`](libs/shared/src/path-match.ts#L18))
- **FR3.3b** The auto-merge decision engine (`evaluateAutoMerge`) MUST squash-merge only when every gate passes and otherwise defer with a specific reason — `dark_mode_off` (overrides everything), `no_changes` (empty PR, checked before the path allowlist), `human_review`, `ci_failed` (only when `require_green_ci`), `bot_changes_requested`, `path_outside_allowlist`, `trust_too_low` (including a repo with no trust set) — and it reports CI/bot-review status in the decision inputs. The trigger wrapper (`evaluateAndMerge`) resolves the PR via the facade-backed policy lookup (no direct octokit) and no-ops without writing an audit row for an orphaned task (no `target_repo`), a `dark_factory.enabled:false` or null-settings repo, or a not-yet-created PR, invoking the merge only when dark mode is on and a PR exists, and propagating merge errors to the caller. ([validated by `auto-merge.test.ts:31`](apps/floor/src/jobs/merge/auto-merge.test.ts#L31), [`auto-merge.test.ts:40`](apps/floor/src/jobs/merge/auto-merge.test.ts#L40), [`auto-merge.test.ts:46`](apps/floor/src/jobs/merge/auto-merge.test.ts#L46), [`auto-merge.test.ts:52`](apps/floor/src/jobs/merge/auto-merge.test.ts#L52), [`auto-merge.test.ts:58`](apps/floor/src/jobs/merge/auto-merge.test.ts#L58), [`auto-merge.test.ts:64`](apps/floor/src/jobs/merge/auto-merge.test.ts#L64), [`auto-merge.test.ts:75`](apps/floor/src/jobs/merge/auto-merge.test.ts#L75), [`auto-merge.test.ts:81`](apps/floor/src/jobs/merge/auto-merge.test.ts#L81), [`auto-merge.test.ts:89`](apps/floor/src/jobs/merge/auto-merge.test.ts#L89), [`auto-merge.test.ts:100`](apps/floor/src/jobs/merge/auto-merge.test.ts#L100), [`auto-merge.test.ts:106`](apps/floor/src/jobs/merge/auto-merge.test.ts#L106), [`auto-merge.test.ts:132`](apps/floor/src/jobs/merge/auto-merge.test.ts#L132), [`auto-merge.test.ts:138`](apps/floor/src/jobs/merge/auto-merge.test.ts#L138), [`auto-merge-trigger.test.ts:50`](apps/floor/src/jobs/merge/auto-merge-trigger.test.ts#L50), [`auto-merge-trigger.test.ts:58`](apps/floor/src/jobs/merge/auto-merge-trigger.test.ts#L58), [`auto-merge-trigger.test.ts:67`](apps/floor/src/jobs/merge/auto-merge-trigger.test.ts#L67), [`auto-merge-trigger.test.ts:75`](apps/floor/src/jobs/merge/auto-merge-trigger.test.ts#L75), [`auto-merge-trigger.test.ts:86`](apps/floor/src/jobs/merge/auto-merge-trigger.test.ts#L86), [`auto-merge-trigger.test.ts:133`](apps/floor/src/jobs/merge/auto-merge-trigger.test.ts#L133), [`auto-merge-trigger.test.ts:143`](apps/floor/src/jobs/merge/auto-merge-trigger.test.ts#L143); implemented by [`auto-merge.ts:60`](apps/floor/src/application/jobs/auto-merge.ts#L60))
- **FR3.4** Sub-setting `review` MUST support `trust_based | always | never`. Default when dark-mode-on: `trust_based`. When `trust_based` is active and a PR's changed paths are *outside* the configured `auto_merge.paths` allowlist, the bot MUST post its inline review comments and verdict and then stop; the PR remains open awaiting human merge. Time-based "no-objection" auto-merge is explicitly out of scope for v1. ([validated by `dark-factory.test.ts:182`](apps/floor/src/jobs/dark-factory/dark-factory.test.ts#L182), [`dark-factory.test.ts:104`](apps/floor/src/jobs/dark-factory/dark-factory.test.ts#L104), [`dark-factory.test.ts:111`](apps/floor/src/jobs/dark-factory/dark-factory.test.ts#L111), [`dark-factory.test.ts:128`](apps/floor/src/jobs/dark-factory/dark-factory.test.ts#L128), [`dark-factory.test.ts:137`](apps/floor/src/jobs/dark-factory/dark-factory.test.ts#L137), [`dark-factory.test.ts:146`](apps/floor/src/jobs/dark-factory/dark-factory.test.ts#L146), [`dark-factory.test.ts:155`](apps/floor/src/jobs/dark-factory/dark-factory.test.ts#L155), [`dark-factory.test.ts:164`](apps/floor/src/jobs/dark-factory/dark-factory.test.ts#L164), [`dark-factory.test.ts:173`](apps/floor/src/jobs/dark-factory/dark-factory.test.ts#L173); implemented by [`dark-factory.ts:100`](apps/floor/src/adapters/dark-factory.ts#L100))
- **FR3.5** Sub-setting `notify` MUST support a list of channels: `escalation`, `watched`, `all`. Default when dark-mode-on: `[escalation]`. ([validated by `notify.test.ts:27`](libs/shared/src/project/notify/notify.test.ts#L27), [`notify.test.ts:40`](libs/shared/src/project/notify/notify.test.ts#L40), [`notify-decision.test.ts:10`](libs/shared/src/project/notify/notify-decision.test.ts#L10), [`notify-decision.test.ts:17`](libs/shared/src/project/notify/notify-decision.test.ts#L17), [`notify-decision.test.ts:24`](libs/shared/src/project/notify/notify-decision.test.ts#L24), [`notify-decision.test.ts:35`](libs/shared/src/project/notify/notify-decision.test.ts#L35), [`notify-slack.test.ts:16`](libs/shared/src/project/notify/notify-slack.test.ts#L16), [`notify-slack.test.ts:30`](libs/shared/src/project/notify/notify-slack.test.ts#L30); implemented by [`notify-decision.ts:13`](libs/shared/src/project/notify/notify-decision.ts#L13))
- **FR3.6** Per-task overrides at creation time MUST be able to force `human_review: required`, `with_issue: true`, or `notify: completion` for a single task without changing repo settings.
- **FR3.7** Auto-merge decisions MUST be recorded in the audit log with the rule that justified them (path matched, trust level, CI status, bot-approval). ([validated by `audit.test.ts:6`](apps/floor/src/jobs/lib/audit.test.ts#L6), [`auto-merge.test.ts:119`](apps/floor/src/jobs/merge/auto-merge.test.ts#L119), [`audit.test.ts:23`](libs/shared/src/project/audit/audit.test.ts#L23), [`audit.test.ts:44`](libs/shared/src/project/audit/audit.test.ts#L44), [`audit-memory.test.ts:5`](libs/shared/src/project/audit/audit-memory.test.ts#L5); implemented by [`auto-merge.ts:60`](apps/floor/src/application/jobs/auto-merge.ts#L60), [`audit.ts:9`](apps/floor/src/adapters/audit.ts#L9))
- **FR3.8** Issues created on escalation MUST contain: task description, branch link, failing phase output (if any), diagnostic from the supervisor, and links to contributing facts/memories. ([validated by `escalation.test.ts:45`](apps/floor/src/jobs/platform/escalation.test.ts#L45), [`escalation.test.ts:65`](apps/floor/src/jobs/platform/escalation.test.ts#L65), [`escalation.test.ts:87`](apps/floor/src/jobs/platform/escalation.test.ts#L87), [`escalation.test.ts:114`](apps/floor/src/jobs/platform/escalation.test.ts#L114), [`escalation.test.ts:132`](apps/floor/src/jobs/platform/escalation.test.ts#L132), [`escalation.test.ts:162`](apps/floor/src/jobs/platform/escalation.test.ts#L162), [`escalation.test.ts:202`](apps/floor/src/jobs/platform/escalation.test.ts#L202), [`infra-failure.test.ts:23`](apps/floor/src/jobs/platform/infra-failure.test.ts#L23); implemented by [`escalation.ts:65`](apps/floor/src/adapters/escalation.ts#L65))
- **FR3.9** Authorization on `dark_factory.*` settings MUST be tiered. Privileged changes — toggling `dark_factory.enabled` and modifying `dark_factory.auto_merge.paths` — MUST require both an admin-scope API token and a CODEOWNERS approval recorded in the audit log (a labeled PR against the settings, or an equivalent ceremony surfaced via the web-ui). Lighter sub-settings (`notify`, `create_issue`, `review`, `auto_merge.min_trust`, `auto_merge.require_*`) MAY be changed with admin scope alone. Every mutation, regardless of tier, MUST write an audit_log entry naming the actor, the previous value, the new value, and the authorization path used. ([validated by `dark-factory.test.ts:250`](apps/lore-api/src/api/routes/dark-factory/dark-factory.test.ts#L250), [`dark-factory-settings.test.ts:108`](apps/lore-api/src/features/dark-factory/dark-factory-settings.test.ts#L108), [`dark-factory-settings.test.ts:113`](apps/lore-api/src/features/dark-factory/dark-factory-settings.test.ts#L113), [`dark-factory-settings.test.ts:119`](apps/lore-api/src/features/dark-factory/dark-factory-settings.test.ts#L119), [`dark-factory-settings.test.ts:128`](apps/lore-api/src/features/dark-factory/dark-factory-settings.test.ts#L128), [`dark-factory-settings.test.ts:137`](apps/lore-api/src/features/dark-factory/dark-factory-settings.test.ts#L137), [`dark-factory-settings.test.ts:147`](apps/lore-api/src/features/dark-factory/dark-factory-settings.test.ts#L147), [`dark-factory-settings.test.ts:206`](apps/lore-api/src/features/dark-factory/dark-factory-settings.test.ts#L206), [`dark-factory-settings.test.ts:215`](apps/lore-api/src/features/dark-factory/dark-factory-settings.test.ts#L215), [`dark-factory.test.ts:178`](apps/lore-api/src/api/routes/dark-factory/dark-factory.test.ts#L178), [`dark-factory.test.ts:197`](apps/lore-api/src/api/routes/dark-factory/dark-factory.test.ts#L197), [`dark-factory.test.ts:239`](apps/lore-api/src/api/routes/dark-factory/dark-factory.test.ts#L239), [`dark-factory.test.ts:258`](apps/lore-api/src/api/routes/dark-factory/dark-factory.test.ts#L258), [`dark-factory.test.ts:351`](apps/lore-api/src/api/routes/dark-factory/dark-factory.test.ts#L351); implemented by [`dark-factory-authz.ts:69`](apps/mcp-server/src/features/dark-factory/dark-factory-authz.ts#L69), [`dark-factory-settings.ts:63`](apps/mcp-server/src/features/dark-factory/dark-factory-settings.ts#L63))

- **FR3.9a** The execution image is a two-key security-boundary field. It MUST resolve to the platform default when no execution settings are present (or settings is null), to the per-repo `dark_factory.execution.image` when set, and to a per-task-type override in preference to the per-repo image — applying that override only to its own task type. The schema accepts an execution image (per-repo and per-task-type) and rejects an empty one; `twoKeyFieldsTouched` flags `execution.image` and a per-task-type `task_overrides` execution image while not flagging non-execution `task_overrides` fields. ([validated by `dark-factory-settings.test.ts:8`](libs/shared/src/dark-factory-settings.test.ts#L8), [`dark-factory-settings.test.ts:14`](libs/shared/src/dark-factory-settings.test.ts#L14), [`dark-factory-settings.test.ts:20`](libs/shared/src/dark-factory-settings.test.ts#L20), [`dark-factory-settings.test.ts:28`](libs/shared/src/dark-factory-settings.test.ts#L28), [`dark-factory-settings.test.ts:41`](libs/shared/src/dark-factory-settings.test.ts#L41), [`dark-factory-settings.test.ts:52`](apps/lore-api/src/features/dark-factory/dark-factory-settings.test.ts#L52), [`dark-factory-settings.test.ts:58`](apps/lore-api/src/features/dark-factory/dark-factory-settings.test.ts#L58), [`dark-factory-settings.test.ts:64`](apps/lore-api/src/features/dark-factory/dark-factory-settings.test.ts#L64), [`dark-factory-settings.test.ts:158`](apps/lore-api/src/features/dark-factory/dark-factory-settings.test.ts#L158), [`dark-factory-settings.test.ts:164`](apps/lore-api/src/features/dark-factory/dark-factory-settings.test.ts#L164), [`dark-factory-settings.test.ts:173`](apps/lore-api/src/features/dark-factory/dark-factory-settings.test.ts#L173), [`dark-factory-settings.test.ts:184`](apps/lore-api/src/features/dark-factory/dark-factory-settings.test.ts#L184), [`dark-factory-settings.test.ts:198`](apps/lore-api/src/features/dark-factory/dark-factory-settings.test.ts#L198); implemented by [`dark-factory-settings.ts:63`](libs/shared/src/dark-factory-settings.ts#L63))

### FR4 — Migration and compatibility

- **FR4.1** All existing repos MUST default to `dark_factory.enabled = false` at migration; behavior is identical to pre-feature.
- **FR4.2** Enabling dark mode on a repo MUST require no schema migration and no agent restart.
- **FR4.3** A repo can revert to `dark_factory.enabled = false` at any time; subsequent tasks behave as today.
- **FR4.4** Existing in-flight tasks at migration time MUST complete using their original flow; dark mode applies to tasks created after enablement.

### FR5 — Observability

- **FR5.1** OpenTelemetry traces MUST cover supervisor phase transitions; each phase produces a span linked to its commit SHA.
- **FR5.2** A repo dashboard view (web-ui) MUST surface: tasks run dark this week, tasks auto-merged, tasks escalated, current trust level, current `dark_factory` settings. ([validated by `RepoOverviewView.test.tsx:129`](apps/web-ui/src/app/repos/[owner]/[repo]/RepoOverviewView.test.tsx#L129), [`DarkFactoryConsoleView.test.tsx:26`](apps/web-ui/src/app/repos/[owner]/[repo]/dark-factory/DarkFactoryConsoleView.test.tsx#L26), [`DarkFactoryConsoleView.test.tsx:33`](apps/web-ui/src/app/repos/[owner]/[repo]/dark-factory/DarkFactoryConsoleView.test.tsx#L33), [`DarkFactoryConsoleView.test.tsx:46`](apps/web-ui/src/app/repos/[owner]/[repo]/dark-factory/DarkFactoryConsoleView.test.tsx#L46), [`DarkFactoryView.test.tsx:32`](apps/web-ui/src/app/repos/[owner]/[repo]/dark-factory/settings/DarkFactoryView.test.tsx#L32), [`DarkFactoryView.test.tsx:56`](apps/web-ui/src/app/repos/[owner]/[repo]/dark-factory/settings/DarkFactoryView.test.tsx#L56), [`DarkFactoryView.test.tsx:66`](apps/web-ui/src/app/repos/[owner]/[repo]/dark-factory/settings/DarkFactoryView.test.tsx#L66), [`AssemblyLineRunListView.test.tsx:26`](apps/web-ui/src/app/assembly-lines/AssemblyLineRunListView.test.tsx#L26), [`AssemblyLineRunListView.test.tsx:42`](apps/web-ui/src/app/assembly-lines/AssemblyLineRunListView.test.tsx#L42), [`AssemblyLineRunsTable.test.tsx:35`](apps/web-ui/src/app/assembly-lines/AssemblyLineRunsTable.test.tsx#L35), [`AssemblyLineRunsTable.test.tsx:41`](apps/web-ui/src/app/assembly-lines/AssemblyLineRunsTable.test.tsx#L41), [`AssemblyLineRunsTable.test.tsx:62`](apps/web-ui/src/app/assembly-lines/AssemblyLineRunsTable.test.tsx#L62), [`AssemblyLineRunsTable.test.tsx:84`](apps/web-ui/src/app/assembly-lines/AssemblyLineRunsTable.test.tsx#L84), [`AssemblyLineRunsTable.test.tsx:97`](apps/web-ui/src/app/assembly-lines/AssemblyLineRunsTable.test.tsx#L97))
- **FR5.3** The web-ui task detail page MUST resolve `Lore-Task: <uuid>` from a PR URL and render the branch's stage timeline. ([validated by `TimelineView.test.tsx:102`](apps/web-ui/src/app/tasks/[id]/TimelineView.test.tsx#L102), [`AssemblyLineRunView.test.tsx:42`](apps/web-ui/src/app/assembly-lines/[id]/AssemblyLineRunView.test.tsx#L42), [`AssemblyLineRunView.test.tsx:55`](apps/web-ui/src/app/assembly-lines/[id]/AssemblyLineRunView.test.tsx#L55), [`AssemblyLineRunView.test.tsx:66`](apps/web-ui/src/app/assembly-lines/[id]/AssemblyLineRunView.test.tsx#L66), [`AssemblyLineRunView.test.tsx:82`](apps/web-ui/src/app/assembly-lines/[id]/AssemblyLineRunView.test.tsx#L82), [`AssemblyLineRunView.test.tsx:104`](apps/web-ui/src/app/assembly-lines/[id]/AssemblyLineRunView.test.tsx#L104), [`AssemblyLineRunView.test.tsx:112`](apps/web-ui/src/app/assembly-lines/[id]/AssemblyLineRunView.test.tsx#L112), [`NodePodLogs.test.tsx:46`](apps/web-ui/src/app/assembly-lines/[id]/NodePodLogs.test.tsx#L46), [`NodePodLogs.test.tsx:54`](apps/web-ui/src/app/assembly-lines/[id]/NodePodLogs.test.tsx#L54), [`node-pod-logs-presenter.test.ts:20`](apps/web-ui/src/app/assembly-lines/[id]/node-pod-logs-presenter.test.ts#L20), [`node-pod-logs-presenter.test.ts:28`](apps/web-ui/src/app/assembly-lines/[id]/node-pod-logs-presenter.test.ts#L28), [`node-pod-logs-presenter.test.ts:32`](apps/web-ui/src/app/assembly-lines/[id]/node-pod-logs-presenter.test.ts#L32), [`node-pod-logs-presenter.test.ts:36`](apps/web-ui/src/app/assembly-lines/[id]/node-pod-logs-presenter.test.ts#L36), [`node-pod-logs-presenter.test.ts:40`](apps/web-ui/src/app/assembly-lines/[id]/node-pod-logs-presenter.test.ts#L40), [`node-pod-logs-presenter.test.ts:48`](apps/web-ui/src/app/assembly-lines/[id]/node-pod-logs-presenter.test.ts#L48), [`node-pod-logs-presenter.test.ts:52`](apps/web-ui/src/app/assembly-lines/[id]/node-pod-logs-presenter.test.ts#L52), [`node-pod-logs-presenter.test.ts:56`](apps/web-ui/src/app/assembly-lines/[id]/node-pod-logs-presenter.test.ts#L56), [`node-pod-logs-presenter.test.ts:60`](apps/web-ui/src/app/assembly-lines/[id]/node-pod-logs-presenter.test.ts#L60); implemented by [`Timeline.tsx:61`](apps/web-ui/src/app/pipeline/[id]/Timeline.tsx#L61), [`task-timeline.ts:62`](apps/mcp-server/src/api/routes/task-timeline.ts#L62))

- **FR5.4** The web-ui MUST provide the intent-definition surface: a create-task form exposing the four task types, a target-repo selector (a dropdown option per onboarded repo, falling back to a free-text input defaulting to `re-cinq/lore` when no repos exist), an immediate-priority checkbox carrying value `immediate`, a required description textarea, and the heading + Create Task submit wired to the injected create-task action. ([validated by `AssemblyLineCreateView.test.tsx:9`](apps/web-ui/src/app/assembly-lines/create/AssemblyLineCreateView.test.tsx#L9), [`AssemblyLineCreateView.test.tsx:21`](apps/web-ui/src/app/assembly-lines/create/AssemblyLineCreateView.test.tsx#L21), [`AssemblyLineCreateView.test.tsx:63`](apps/web-ui/src/app/assembly-lines/create/AssemblyLineCreateView.test.tsx#L63), [`AssemblyLineCreateView.test.tsx:76`](apps/web-ui/src/app/assembly-lines/create/AssemblyLineCreateView.test.tsx#L76), [`AssemblyLineCreateView.test.tsx:90`](apps/web-ui/src/app/assembly-lines/create/AssemblyLineCreateView.test.tsx#L90), [`AssemblyLineCreateView.test.tsx:103`](apps/web-ui/src/app/assembly-lines/create/AssemblyLineCreateView.test.tsx#L103))

### FR6 — Assembly line identity

- **FR6.1** Every assembly line execution MUST have a first-class per-attempt identity: a `pipeline.assembly_lines` row with a fresh uuid, distinct across retries and resumes of the same task. The task id remains stable across attempts; the assemblyLineId does not. ([validated by `assembly-lines.test.ts:223`](libs/shared/src/project/assembly-lines/assembly-lines.test.ts#L230); implemented by [`0025_assembly_lines.sql`](infra/terraform/modules/gke-mcp/lore-platform/charts/ui-helm/migrations/0025_assembly_lines.sql))
- **FR6.1a** The `pipeline.assembly_lines` row supports the full attempt lifecycle (Pg adapter and in-memory double sharing one behavior): `markRunning` stamps `running` + `started_at` guarded against terminal rows (throwing on unknown ids), `finish` stamps `finished`/`failed` with the outcome, reason (on `error`), and `finished_at`; `getById` maps the row to an `AssemblyLineRecord` (null args → empty object) and returns null for unknown ids; `listForTask` returns only that task's rows newest-first; `findOpenByPr` matches repo + `args.pr_number` on open statuses only (excluding finished rows and other PRs) and `finishOpenByPr` closes only those and returns the count — the PR-keyed lookup that lets code-review reuse an open line. ([validated by `assembly-lines.test.ts:73`](libs/shared/src/project/assembly-lines/assembly-lines.test.ts#L73), [`assembly-lines.test.ts:85`](libs/shared/src/project/assembly-lines/assembly-lines.test.ts#L85), [`assembly-lines.test.ts:97`](libs/shared/src/project/assembly-lines/assembly-lines.test.ts#L106), [`assembly-lines.test.ts:113`](libs/shared/src/project/assembly-lines/assembly-lines.test.ts#L122), [`assembly-lines.test.ts:153`](libs/shared/src/project/assembly-lines/assembly-lines.test.ts#L162), [`assembly-lines.test.ts:159`](libs/shared/src/project/assembly-lines/assembly-lines.test.ts#L168), [`assembly-lines.test.ts:183`](libs/shared/src/project/assembly-lines/assembly-lines.test.ts#L192), [`assembly-lines.test.ts:193`](libs/shared/src/project/assembly-lines/assembly-lines.test.ts#L202), [`assembly-lines.test.ts:204`](libs/shared/src/project/assembly-lines/assembly-lines.test.ts#L213), [`assembly-lines.test.ts:258`](libs/shared/src/project/assembly-lines/assembly-lines.test.ts#L247), [`assembly-lines.test.ts:271`](libs/shared/src/project/assembly-lines/assembly-lines.test.ts#L247), [`assembly-lines.test.ts:288`](libs/shared/src/project/assembly-lines/assembly-lines.test.ts#L307), [`assembly-lines.test.ts:356`](libs/shared/src/project/assembly-lines/assembly-lines.test.ts#L370), [`assembly-lines.test.ts:368`](libs/shared/src/project/assembly-lines/assembly-lines.test.ts#L370), [`assembly-lines.test.ts:382`](libs/shared/src/project/assembly-lines/assembly-lines.test.ts#L392), [`assembly-lines.test.ts:410`](libs/shared/src/project/assembly-lines/assembly-lines.test.ts#L418), [`assembly-lines.test.ts:440`](libs/shared/src/project/assembly-lines/assembly-lines.test.ts#L446), [`assembly-lines.test.ts:481`](libs/shared/src/project/assembly-lines/assembly-lines.test.ts#L501), [`assembly-lines.test.ts:490`](libs/shared/src/project/assembly-lines/assembly-lines.test.ts#L501), [`assembly-lines.test.ts:731`](libs/shared/src/project/assembly-lines/assembly-lines.test.ts#L725); implemented by [`assembly-lines-pg.ts:19`](libs/shared/src/project/assembly-lines/assembly-lines-pg.ts#L19))
- **FR6.2** `project.assemblyLines.start(definitionName, opts)` MUST mint the assemblyLineId, persist the row (status `queued`), and insert the `assembly_line.start` event (source `internal`, dedupe key `assembly_line.start:<assemblyLineId>`, denormalized `repo` column) in one atomic statement, returning the id immediately — execution is picked up by the Floor event loop, never awaited by the caller. ([validated by `assembly-lines.test.ts:27`](libs/shared/src/project/assembly-lines/assembly-lines.test.ts#L27), [`project.test.ts:73`](libs/shared/src/project/lib/project.test.ts#L73), [`assembly-lines.test.ts:56`](libs/shared/src/project/assembly-lines/assembly-lines.test.ts#L56), [`assembly-lines.test.ts:467`](libs/shared/src/project/assembly-lines/assembly-lines.test.ts#L476), [`assembly-line-station-backend.test.ts:18`](apps/floor/src/jobs/assembly-line/assembly-line-station-backend.test.ts#L18), [`assembly-line-station-backend.test.ts:44`](apps/floor/src/jobs/assembly-line/assembly-line-station-backend.test.ts#L44); implemented by [`assembly-lines-pg.ts:19`](libs/shared/src/project/assembly-lines/assembly-lines-pg.ts#L19))
- **FR6.3** Every node execution MUST be associated with its assemblyLineId: a `pipeline.assembly_line_nodes` row records the node id, iteration, outcome, Agent CR name, and stage-commit sha. ([validated by `assembly-lines.test.ts:304`](libs/shared/src/project/assembly-lines/assembly-lines.test.ts#L324); implemented by [`assembly-lines-pg.ts:88`](libs/shared/src/project/assembly-lines/assembly-lines-pg.ts#L88))
- **FR6.4** *(re-scoped 2026-07)* Lore-authored commits (agent pods) carry the `Lore-Assembly-Line: <id>` trailer alongside `Lore-Task`; both are optional on parse (task-less lines omit `Lore-Task`). Floor-side stage commits retired with the in-process walk — the per-node record is the `pipeline.assembly_line_nodes` row (FR6.3), not a commit. `Lore-Assembly-Line` is emitted after the required keys only when an assemblyLineId is set and is omitted otherwise, and it round-trips through `parseTrailers` as a first-class field (not an extra), with pre-existing task-less blocks parsing back to an empty `taskId`. ([validated by `commit-trailers.test.ts:68`](libs/shared/src/commit-trailers.test.ts#L68), [`commit-trailers.test.ts:44`](libs/shared/src/commit-trailers.test.ts#L44), [`commit-trailers.test.ts:58`](libs/shared/src/commit-trailers.test.ts#L58), [`commit-trailers.test.ts:91`](libs/shared/src/commit-trailers.test.ts#L91), [`commit-trailers.test.ts:102`](libs/shared/src/commit-trailers.test.ts#L102), [`commit-trailers.test.ts:115`](libs/shared/src/commit-trailers.test.ts#L115); implemented by [`commit-trailers.ts:34`](libs/shared/src/commit-trailers.ts#L34))
- **FR6.5** Agent CR names MUST key on the assemblyLineId, not the task id — `<assemblyLineId:8>-<nodeId>` — so two attempts of one task never collide on a CR. The CR spec keeps the `taskId` field (the watcher/reaper probe by task-id label). ([validated by `floor-assembly-line.test.ts:21`](apps/floor/src/jobs/assembly-line/floor-assembly-line.test.ts#L21), [`floor-assembly-line.test.ts:48`](apps/floor/src/jobs/assembly-line/floor-assembly-line.test.ts#L48), [`floor-assembly-line.test.ts:54`](apps/floor/src/jobs/assembly-line/floor-assembly-line.test.ts#L54), [`floor-assembly-line.test.ts:66`](apps/floor/src/jobs/assembly-line/floor-assembly-line.test.ts#L66), [`floor-assembly-line.test.ts:133`](apps/floor/src/jobs/assembly-line/floor-assembly-line.test.ts#L133); implemented by [`floor-assembly-line.ts:32`](apps/floor/src/jobs/assembly-line/floor-assembly-line.ts#L32))
- **FR6.6** *(restated 2026-07)* Every node execution — including back-edge re-iterations — MUST be recorded in `pipeline.assembly_line_nodes`: `ensureNodeStart` before the CR launches (with the CR name), `finishNodeOnce` at its terminal outcome. The rows ARE the walk state (FR6.9), not an observability side-channel. ([validated by `assembly-lines.test.ts:533`](libs/shared/src/project/assembly-lines/assembly-lines.test.ts#L546), [`advance.test.ts:87`](apps/floor/src/jobs/assembly-line/advance.test.ts#L92), [`assembly-lines.test.ts:334`](libs/shared/src/project/assembly-lines/assembly-lines.test.ts#L340), [`assembly-lines.test.ts:511`](libs/shared/src/project/assembly-lines/assembly-lines.test.ts#L523), [`assembly-lines.test.ts:552`](libs/shared/src/project/assembly-lines/assembly-lines.test.ts#L567), [`assembly-lines.test.ts:569`](libs/shared/src/project/assembly-lines/assembly-lines.test.ts#L589), [`assembly-lines.test.ts:596`](libs/shared/src/project/assembly-lines/assembly-lines.test.ts#L608), [`assembly-lines.test.ts:611`](libs/shared/src/project/assembly-lines/assembly-lines.test.ts#L625), [`assembly-lines.test.ts:632`](libs/shared/src/project/assembly-lines/assembly-lines.test.ts#L652), [`assembly-lines.test.ts:644`](libs/shared/src/project/assembly-lines/assembly-lines.test.ts#L652), [`assembly-lines.test.ts:656`](libs/shared/src/project/assembly-lines/assembly-lines.test.ts#L667), [`assembly-lines.test.ts:669`](libs/shared/src/project/assembly-lines/assembly-lines.test.ts#L688), [`assembly-lines.test.ts:705`](libs/shared/src/project/assembly-lines/assembly-lines.test.ts#L725), [`assembly-lines.test.ts:716`](libs/shared/src/project/assembly-lines/assembly-lines.test.ts#L725); implemented by [`assembly-lines-pg.ts:77`](libs/shared/src/project/assembly-lines/assembly-lines-pg.ts#L77), [`advance.ts:143`](apps/floor/src/jobs/assembly-line/advance.ts#L143))

- **FR6.7** *(rewritten 2026-07: event-driven walk)* The `assembly_line.start` handler MUST be the sole executor entry: it validates the definition (a task-less row with an unknown definition closes as failed and resolves — configuration errors never retry), marks the row running, and routes by definition shape (detect-shaped definitions to the repo-less detect runner; single-CR rows — task-backed, no builtin definition — mark running and return, per FR6.8; every other definition launches the ENTRY node's Agent CR and returns). It neither clones, nor supervises, nor backgrounds a walk — the walk advances per FR6.9, so a Floor restart loses nothing. A launch failure propagates so the event loop retries (the advance path is idempotent end to end). ([validated by `start-event-handler.test.ts:87`](apps/floor/src/jobs/assembly-line/start-event-handler.test.ts#L87), [`start-event-handler.test.ts:111`](apps/floor/src/jobs/assembly-line/start-event-handler.test.ts#L111), [`start-event-handler.test.ts:127`](apps/floor/src/jobs/assembly-line/start-event-handler.test.ts#L127), [`start-event-handler.test.ts:141`](apps/floor/src/jobs/assembly-line/start-event-handler.test.ts#L141), [`start-event-handler.test.ts:99`](apps/floor/src/jobs/assembly-line/start-event-handler.test.ts#L99), [`start-event-handler.test.ts:175`](apps/floor/src/jobs/assembly-line/start-event-handler.test.ts#L198); implemented by [`start-event-handler.ts:36`](apps/floor/src/jobs/assembly-line/start-event-handler.ts#L36), [`advance.ts:54`](apps/floor/src/jobs/assembly-line/advance.ts#L54))

- **FR6.8** Every Agent-CR task execution MUST have a run row — single-CR task types (onboard / review / runbook: no builtin assembly line) also create a `pipeline.assembly_lines` row at launch (`task_id` set, zero node rows), so the run table is the total execution history. The start handler marks such rows running without walking; the agent-watcher closes them from the task's post-handler status (`pr-created`/`review` → `pr_created`, `failed`/`needs-human-help` → `failed`, `completed` → `completed`) when the task's one CR goes terminal, falling back to the CR phase for an un-advanced task (a `Failed` CR whose task is still `running` closes `failed`, not `completed`). Token reclaim keys on the task type's routing, not on row existence. `shouldUseAssemblyLine` routes an assembly-line-having task type (implementation/general/gap-fill) to the line backend and the rest (onboard/runbook: no builtin definition) to the single-Agent backend; the assembly-line branch does not double-create a row (its `start()` lives in the line backend), and a crash-recovery re-dispatch that finds an already-open row skips minting a phantom second row while still re-dispatching the CR; `isActive` probes only the single-Agent backend. ([validated by `agent-cr-station-backend.test.ts:95`](apps/floor/src/jobs/station/agent-cr-station-backend.test.ts#L95), [`agent-cr-station-backend.test.ts:41`](apps/floor/src/jobs/station/agent-cr-station-backend.test.ts#L41), [`agent-cr-station-backend.test.ts:46`](apps/floor/src/jobs/station/agent-cr-station-backend.test.ts#L46), [`agent-cr-station-backend.test.ts:80`](apps/floor/src/jobs/station/agent-cr-station-backend.test.ts#L80), [`agent-cr-station-backend.test.ts:111`](apps/floor/src/jobs/station/agent-cr-station-backend.test.ts#L111), [`agent-cr-station-backend.test.ts:119`](apps/floor/src/jobs/station/agent-cr-station-backend.test.ts#L119), [`agent-cr-station-backend.test.ts:130`](apps/floor/src/jobs/station/agent-cr-station-backend.test.ts#L130), [`start-event-handler.test.ts:162`](apps/floor/src/jobs/assembly-line/start-event-handler.test.ts#L185), [`agent-watcher-logic.test.ts:87`](apps/floor/src/jobs/watcher/agent-watcher-logic.test.ts#L87); implemented by [`agent-cr-station-backend.ts:38`](apps/floor/src/jobs/station/agent-cr-station-backend.ts#L38), [`agent-watcher.ts:336`](apps/floor/src/jobs/watcher/agent-watcher.ts#L336))

- **FR6.9** The walk MUST be event-driven and idempotent: node CRs carry `lore.re-cinq.com/assembly-line-id` (full uuid) + `node-id` + `iteration` labels; their terminal phases produce `kubernetes.agent_node.{succeeded,failed}` events deduped PER CR (`k8s:<crName>:<phase>` — all node CRs of one line share the synthetic task-id label, so a task-keyed dedupe would swallow every node after the first). CR names embed the iteration (`<assemblyLineId:8>-<nodeId>-<iteration>`) so a revisited node runs a fresh pod rather than 409-reusing the prior iteration's terminal CR. The transition handler parses the outcome (LORE_NODE_RESULT → REVIEW_RESULT → phase precedence), records it via compare-and-set, and re-derives the next step purely from the persisted node rows (`nextTransition` replays the executor's exact edge/iteration_max routing). Duplicate and concurrent transitions MUST converge structurally: UNIQUE `(assembly_line_id, node_id, iteration)`, CAS node outcome, first-writer-wins row finish, 409-idempotent CR creates. The single-agent watcher path MUST never process labeled node CRs. ([validated by `k8s-map.test.ts:23`](apps/floor/src/listeners/k8s-map.test.ts#L23), [`node-event-handler.test.ts:94`](apps/floor/src/jobs/assembly-line/node-event-handler.test.ts#L94), [`advance.test.ts:106`](apps/floor/src/jobs/assembly-line/advance.test.ts#L111), [`transition.test.ts:172`](libs/assembly-lines/src/transition.test.ts#L172), [`advance.test.ts:120`](apps/floor/src/jobs/assembly-line/advance.test.ts#L125), [`advance.test.ts:132`](apps/floor/src/jobs/assembly-line/advance.test.ts#L137), [`advance.test.ts:150`](apps/floor/src/jobs/assembly-line/advance.test.ts#L155), [`advance.test.ts:195`](apps/floor/src/jobs/assembly-line/advance.test.ts#L200), [`advance.test.ts:234`](apps/floor/src/jobs/assembly-line/advance.test.ts#L239), [`advance.test.ts:258`](apps/floor/src/jobs/assembly-line/advance.test.ts#L263), [`advance.test.ts:324`](apps/floor/src/jobs/assembly-line/advance.test.ts#L329), [`advance.test.ts:350`](apps/floor/src/jobs/assembly-line/advance.test.ts#L355), [`advance.test.ts:368`](apps/floor/src/jobs/assembly-line/advance.test.ts#L373), [`advance.test.ts:409`](apps/floor/src/jobs/assembly-line/advance.test.ts#L492), [`node-event-handler.test.ts:139`](apps/floor/src/jobs/assembly-line/node-event-handler.test.ts#L139), [`node-event-handler.test.ts:180`](apps/floor/src/jobs/assembly-line/node-event-handler.test.ts#L180), [`node-event-handler.test.ts:191`](apps/floor/src/jobs/assembly-line/node-event-handler.test.ts#L191), [`node-event-handler.test.ts:202`](apps/floor/src/jobs/assembly-line/node-event-handler.test.ts#L202), [`node-outcome.test.ts:34`](libs/assembly-lines/src/node-outcome.test.ts#L34), [`node-outcome.test.ts:41`](libs/assembly-lines/src/node-outcome.test.ts#L41), [`node-outcome.test.ts:48`](libs/assembly-lines/src/node-outcome.test.ts#L48), [`node-outcome.test.ts:61`](libs/assembly-lines/src/node-outcome.test.ts#L61), [`node-outcome.test.ts:76`](libs/assembly-lines/src/node-outcome.test.ts#L76), [`node-outcome.test.ts:93`](libs/assembly-lines/src/node-outcome.test.ts#L93), [`node-outcome.test.ts:130`](libs/assembly-lines/src/node-outcome.test.ts#L130), [`node-outcome.test.ts:137`](libs/assembly-lines/src/node-outcome.test.ts#L137); implemented by [`advance.ts:54`](apps/floor/src/jobs/assembly-line/advance.ts#L54), [`node-event-handler.ts:24`](apps/floor/src/jobs/assembly-line/node-event-handler.ts#L24), [`k8s-map.ts:37`](apps/floor/src/listeners/k8s-map.ts#L37))

- **FR6.10** A per-minute reaper (`cron.assembly_line_reaper.tick`) MUST converge every open line — it is the ONLY recovery for a dead-lettered transition (dedupe rows make reconcile re-emits permanent no-ops): an open node whose CR is terminal resolves its real outcome; a rowed-but-unlaunched node relaunches (409 no-op if the CR exists); a node past `timeout_minutes` (+2 min buffer, default 62) fails as a timeout and transitions; a row queued >30 min fails with a reason; a running row with no open node re-advances (the replay converges); a single-CR (definition-less) row whose backing task is terminal is closed from that task's status. Every open line either progresses or terminally fails — bounded. ([validated by `assembly-line-reaper.test.ts:38`](apps/floor/src/jobs/assembly-line/assembly-line-reaper.test.ts#L38), [`assembly-line-reaper.test.ts:128`](apps/floor/src/jobs/assembly-line/assembly-line-reaper.test.ts#L128), [`assembly-line-reaper.test.ts:52`](apps/floor/src/jobs/assembly-line/assembly-line-reaper.test.ts#L52), [`assembly-line-reaper.test.ts:63`](apps/floor/src/jobs/assembly-line/assembly-line-reaper.test.ts#L63), [`assembly-line-reaper.test.ts:74`](apps/floor/src/jobs/assembly-line/assembly-line-reaper.test.ts#L74), [`assembly-line-reaper.test.ts:93`](apps/floor/src/jobs/assembly-line/assembly-line-reaper.test.ts#L93), [`assembly-line-reaper.test.ts:159`](apps/floor/src/jobs/assembly-line/assembly-line-reaper.test.ts#L159), [`assembly-line-reaper.test.ts:187`](apps/floor/src/jobs/assembly-line/assembly-line-reaper.test.ts#L187), [`assembly-line-reaper.test.ts:208`](apps/floor/src/jobs/assembly-line/assembly-line-reaper.test.ts#L208), [`assembly-line-reaper.test.ts:225`](apps/floor/src/jobs/assembly-line/assembly-line-reaper.test.ts#L225), [`assembly-line-reaper.test.ts:240`](apps/floor/src/jobs/assembly-line/assembly-line-reaper.test.ts#L240); implemented by [`assembly-line-reaper.ts:76`](apps/floor/src/jobs/assembly-line/assembly-line-reaper.ts#L76))
- **FR6.11** An Agent's `status.output` is an NDJSON event stream whose terminal line carries the agent text inside a JSON string field (`{"type":"result","result":"…"}`), so newlines and any embedded JSON arrive escaped. The Floor MUST unwrap that envelope once, at the read boundary, before any text parser runs — a parser scanning for a single-line marker survives the escaping while one needing a real newline (the ```REVIEW_FINDINGS block) silently matches nothing, which yields a node that records `changes_requested` while the PR receives no review at all. Unwrapping MUST be idempotent so already-plain and legacy output pass through unchanged, and MUST (transitionally, until no pre-cutover CRs remain) also peel the ai-agent-subsystem's `{"source": {...}, "event": <line>}` attribution envelope that older runs stamped onto every stdout line — the result object rides at `.event` there. The duties a terminal node owes — post the review, record the outcome and advance, publish the PR check — MUST be shared by the event path and the reaper (FR6.10), and the review MUST be posted BEFORE the state transition, since both paths ignore a non-running row and a post attempted after it can never be repaired by a retry. A review that reaches a verdict but posts nothing, and a check that fails to publish, MUST be audited (`review_findings_unparsed` / `review_post_failed` / `pr_check_publish_failed`) rather than warned away — each is indistinguishable from a clean review at the PR. ([validated by `agent-output.test.ts:28`](libs/assembly-lines/src/agent-output.test.ts#L28), [`agent-output.test.ts:34`](libs/assembly-lines/src/agent-output.test.ts#L34), [`agent-output.test.ts:41`](libs/assembly-lines/src/agent-output.test.ts#L41), [`agent-output.test.ts:53`](libs/assembly-lines/src/agent-output.test.ts#L53), [`agent-output.test.ts:61`](libs/assembly-lines/src/agent-output.test.ts#L61), [`agent-output.test.ts:67`](libs/assembly-lines/src/agent-output.test.ts#L67), [`agent-output.test.ts:73`](libs/assembly-lines/src/agent-output.test.ts#L73), [`agent-output.test.ts:79`](libs/assembly-lines/src/agent-output.test.ts#L79), [`agent-output.test.ts:89`](libs/assembly-lines/src/agent-output.test.ts#L89), [`agent-output.test.ts:93`](libs/assembly-lines/src/agent-output.test.ts#L93), [`agent-output.test.ts:99`](libs/assembly-lines/src/agent-output.test.ts#L99), [`agent-output.test.ts:111`](libs/assembly-lines/src/agent-output.test.ts#L111), [`agent-output.test.ts:133`](libs/assembly-lines/src/agent-output.test.ts#L133), [`node-terminal.test.ts:69`](apps/floor/src/jobs/assembly-line/node-terminal.test.ts#L73), [`node-terminal.test.ts:82`](apps/floor/src/jobs/assembly-line/node-terminal.test.ts#L86), [`node-terminal.test.ts:88`](apps/floor/src/jobs/assembly-line/node-terminal.test.ts#L92), [`node-event-handler.test.ts:157`](apps/floor/src/jobs/assembly-line/node-event-handler.test.ts#L157); implemented by [`agent-output.ts:73`](libs/assembly-lines/src/agent-output.ts#L73), [`node-terminal.ts:51`](apps/floor/src/jobs/assembly-line/node-terminal.ts#L51))
- **FR6.12** *(added 2026-07-17)* Every assembly-line closure with a failure outcome MUST notify the user through one generic seam — no definition-specific notification code. `finishLine` (the single closure path for the walk and the reaper) fires the notifier for any outcome outside the benign set (`completed`, `lease_held`, `pr_created`, `changes_requested`, `pr_closed`) and stays silent for benign closures, including the `lease_held` overlap defer. ([validated by `notify-failure.test.ts:32`](apps/floor/src/jobs/assembly-line/notify-failure.test.ts#L32), [`notify-failure.test.ts:38`](apps/floor/src/jobs/assembly-line/notify-failure.test.ts#L38), [`advance.test.ts:427`](apps/floor/src/jobs/assembly-line/advance.test.ts#L427), [`advance.test.ts:440`](apps/floor/src/jobs/assembly-line/advance.test.ts#L440); implemented by [`notify-failure.ts:26`](apps/floor/src/jobs/assembly-line/notify-failure.ts#L26), [`advance.ts:238`](apps/floor/src/jobs/assembly-line/advance.ts#L229))
  - Notification MUST fire exactly once per line — only the winner of the first-writer-wins `finish` CAS notifies (the port reports the win as its return value, in the Pg adapter and the in-memory double alike), and a notifier throw never fails the line transition or re-drives the event retry. ([validated by `advance.test.ts:458`](apps/floor/src/jobs/assembly-line/advance.test.ts#L458), [`advance.test.ts:472`](apps/floor/src/jobs/assembly-line/advance.test.ts#L472), [`assembly-lines.test.ts:97`](libs/shared/src/project/assembly-lines/assembly-lines.test.ts#L97), [`assembly-lines.test.ts:295`](libs/shared/src/project/assembly-lines/assembly-lines.test.ts#L295); implemented by [`assembly-lines-pg.ts:67`](libs/shared/src/project/assembly-lines/assembly-lines-pg.ts#L67))
  - Channels: an `escalation`-level message through the repo's `dark_factory.notify` routing carrying the definition, repo, outcome, reason, and run link; plus, when the line is PR-linked, a PR comment with the run link (and the `@lore review` re-run hint on `code-review` lines — omitted for other definitions; lines without a `pr_number` send no comment). Each send is best-effort: a failed send is audited as `failure_notify_failed` with its channel, and the other channel still fires. ([validated by `notify-failure.test.ts:48`](apps/floor/src/jobs/assembly-line/notify-failure.test.ts#L48), [`notify-failure.test.ts:65`](apps/floor/src/jobs/assembly-line/notify-failure.test.ts#L65), [`notify-failure.test.ts:80`](apps/floor/src/jobs/assembly-line/notify-failure.test.ts#L80), [`notify-failure.test.ts:91`](apps/floor/src/jobs/assembly-line/notify-failure.test.ts#L91), [`notify-failure.test.ts:138`](apps/floor/src/jobs/assembly-line/notify-failure.test.ts#L138), [`notify-failure.test.ts:154`](apps/floor/src/jobs/assembly-line/notify-failure.test.ts#L154), [`notify-failure.test.ts:168`](apps/floor/src/jobs/assembly-line/notify-failure.test.ts#L168), [`notify-failure.test.ts:183`](apps/floor/src/jobs/assembly-line/notify-failure.test.ts#L183); implemented by [`notify-failure.ts:74`](apps/floor/src/jobs/assembly-line/notify-failure.ts#L71))
  - The one closure that bypasses `finishLine` — the start handler's task-less unknown-definition config error — notifies through the same contract, winner-gated so a redelivered start event never re-notifies. ([validated by `start-event-handler.test.ts:162`](apps/floor/src/jobs/assembly-line/start-event-handler.test.ts#L162); implemented by [`start-event-handler.ts:70`](apps/floor/src/jobs/assembly-line/start-event-handler.ts#L82))
- **FR6.13** *(added 2026-07-17)* A line's terminal state MUST be honest about node failures. A walk that reaches exit with a `failed` node visit closes the row with outcome `failed` and a `node "<id>" failed` reason instead of `completed` — every definition routes `failed` edges toward exit, so "completed" would render a green check over a failed review. ([validated by `advance.test.ts:412`](apps/floor/src/jobs/assembly-line/advance.test.ts#L412); implemented by [`advance.ts:53`](apps/floor/src/jobs/assembly-line/advance.ts#L55))
  - The PR check maps a `failed` line outcome to a failure conclusion carrying the reason (plus the `@lore review` re-run hint on `code-review` lines) — keying on row status alone would miss it, since only `error` flips the status column. ([validated by `pr-check.test.ts:60`](apps/floor/src/jobs/assembly-line/pr-check.test.ts#L60), [`pr-check.test.ts:76`](apps/floor/src/jobs/assembly-line/pr-check.test.ts#L76); implemented by [`pr-check.ts:56`](apps/floor/src/jobs/assembly-line/pr-check.ts#L61))
  - The review post reports how it went (`posted` / `no_findings` / `post_failed` / `not_review`), and the outage shape — no findings AND no verdict, e.g. an agent that could not read the diff yet exited 0 — records the node as `failed` rather than `success`, so the generic FR6.12 notification catches it. A verdict without a findings block stays untouched (a legitimate minimal approve), as do posted findings and non-review nodes. ([validated by `node-terminal.test.ts:177`](apps/floor/src/jobs/assembly-line/node-terminal.test.ts#L177), [`node-terminal.test.ts:204`](apps/floor/src/jobs/assembly-line/node-terminal.test.ts#L204), [`node-terminal.test.ts:216`](apps/floor/src/jobs/assembly-line/node-terminal.test.ts#L216), [`node-terminal.test.ts:226`](apps/floor/src/jobs/assembly-line/node-terminal.test.ts#L226), [`node-terminal.test.ts:236`](apps/floor/src/jobs/assembly-line/node-terminal.test.ts#L236); implemented by [`node-terminal.ts:68`](apps/floor/src/jobs/assembly-line/node-terminal.ts#L68))

- **FR6.14** *(added 2026-07-17)* A node CR that fails because the Anthropic account ran dry (`Credit balance is too low` / `insufficient credit`) MUST raise ONE throttled operator alert, distinct from the per-line FR6.12 failure notice. Such a failure downs every LLM node — review, refine, triage, implementation — at once, so a per-run notice would flood the channel while a code fix would do nothing; the fix is topping up the account. The classifier reads the agent's terminal error text (`terminalErrorText` — the last `is_error` result line, peeled from the same NDJSON/attribution envelope as FR6.11, since the CR's own `failureReason` is only the Job-level `BackoffLimitExceeded`); a global time-window throttle (account-wide, so one alert per window across all repos, not per drowned run) gates the `escalation`-level Slack send; and the whole path is best-effort — a notify throw is logged, never propagated, so it cannot fail the node-event handler or re-drive the event. Non-billing failures neither alert nor consume the throttle. ([validated by `billing-alert.test.ts:15`](apps/floor/src/jobs/assembly-line/billing-alert.test.ts#L15), [`billing-alert.test.ts:27`](apps/floor/src/jobs/assembly-line/billing-alert.test.ts#L27), [`billing-alert.test.ts:35`](apps/floor/src/jobs/assembly-line/billing-alert.test.ts#L35), [`billing-alert.test.ts:50`](apps/floor/src/jobs/assembly-line/billing-alert.test.ts#L50), [`billing-alert.test.ts:65`](apps/floor/src/jobs/assembly-line/billing-alert.test.ts#L65), [`billing-alert.test.ts:85`](apps/floor/src/jobs/assembly-line/billing-alert.test.ts#L85), [`billing-alert.test.ts:110`](apps/floor/src/jobs/assembly-line/billing-alert.test.ts#L110), [`node-event-handler.test.ts:111`](apps/floor/src/jobs/assembly-line/node-event-handler.test.ts#L111), [`node-event-handler.test.ts:126`](apps/floor/src/jobs/assembly-line/node-event-handler.test.ts#L126), [`node-outcome.test.ts:116`](libs/assembly-lines/src/node-outcome.test.ts#L116), [`node-outcome.test.ts:122`](libs/assembly-lines/src/node-outcome.test.ts#L122), [`agent-output.test.ts:144`](libs/assembly-lines/src/agent-output.test.ts#L144), [`agent-output.test.ts:154`](libs/assembly-lines/src/agent-output.test.ts#L154), [`agent-output.test.ts:164`](libs/assembly-lines/src/agent-output.test.ts#L164), [`agent-output.test.ts:172`](libs/assembly-lines/src/agent-output.test.ts#L172); implemented by [`billing-alert.ts:29`](apps/floor/src/jobs/assembly-line/billing-alert.ts#L29), [`node-event-handler.ts:76`](apps/floor/src/jobs/assembly-line/node-event-handler.ts#L76))

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
For a representative onboarded repo, **the number of GitHub Issues created by Lore drops by at least 80%** when comparing the 30-day post-enable window against the 30-day pre-enable baseline (captured in `pipeline.dark_factory_baseline` per T011b), while task throughput stays equal or higher ([validated by `dark-factory-baseline.test.ts:30`](apps/floor/src/jobs/dark-factory/dark-factory-baseline.test.ts#L30), [`dark-factory-baseline.test.ts:52`](apps/floor/src/jobs/dark-factory/dark-factory-baseline.test.ts#L52), [`dark-factory-baseline.test.ts:70`](apps/floor/src/jobs/dark-factory/dark-factory-baseline.test.ts#L70)).

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
