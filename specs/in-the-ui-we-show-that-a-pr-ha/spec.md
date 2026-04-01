# Feature Specification: PR State Visibility

| Field             | Value                                      |
|-------------------|--------------------------------------------|
| Feature           | PR State Visibility                        |
| Branch            | feat/pr-state-visibility                   |
| Status            | Draft                                      |
| Created           | 2026-03-26                                 |
| Owner             | Platform Engineering                       |
| Phase 0 Target    | 2-3 working days                           |
| Full Stack Target | 4-5 weeks                                  |

## Problem Statement

When developers create a PR through Lore (via pipeline tasks, `/lore-pr`,
or agent delegation), the system notifies them via GitHub Issue that the
PR was created. However, the notification and UI only show that a PR
exists — not its current state (draft/ready, blocked, failing checks,
review status). Developers must context-switch to GitHub to understand
whether their PR is ready to merge, why it's blocked, or what action is
needed next. This friction slows PR review cycles and creates blind
spots in task visibility.

The related GitHub Issue (`lore-managed` label) also does not reflect
the PR's live state. Once the issue is closed (PR created), developers
lose visibility into whether the PR itself is still under review,
blocked on tests, or has merged.

## Vision

Developers see PR state directly in Lore without switching context:
- **PR status card** in the task view shows live status (draft/ready,
  CI passing/failing, review requested/approved/merged)
- **GitHub Issue updates** reflect PR state changes (CI failed, review
  requested, approved, merged)
- **MCP tool** (`get_pr_status`) returns structured PR state for Claude
  Code to act on programmatically
- **Memory integration** allows agents to remember why a PR was blocked
  and auto-react when the blocker is cleared

All state is polled from GitHub, no webhooks needed. Polling is triggered
by task creation, MCP calls, and a scheduled background job.

## User Personas

### Developer (Implementing a Feature)

A developer completes a feature, `/lore-pr` creates a branch and PR. They
want to know: Is CI passing? Who approved? What comments are blocking
merge? Today they context-switch to GitHub. Tomorrow, Lore shows all of
this live.

### Code Reviewer (Human)

A reviewer wants to track which agent-created PRs are waiting for their
review, which are blocked, which are ready to merge. Lore should surface
this without them visiting GitHub dashboard.

### Platform Engineer (Monitoring Agents)

Runs scheduled jobs that detect agent PRs stuck in review, failing CI, or
blocked on comments. Needs PR state in MCP tools so agents can react
(auto-fix failures, summarize blocking feedback).

## User Scenarios & Acceptance Criteria

### Scenario 1: Feature Branch PR Created

**Actor:** Developer

**Flow:**
1. Developer types `/lore-pr` in Claude Code
2. Agent creates feature branch, commits changes, opens PR
3. Task immediately polls GitHub for PR state
4. Task view (UI + MCP) shows PR as `draft` with link
5. CI job starts (visible in GitHub checks)
6. Polling detects CI started, task shows `running-checks`
7. CI passes, task shows `ready-for-review`
8. Developer sees green checkmark, knows PR is OK to request review

**Acceptance Criteria:**
- PR state reflects within 10 seconds of creation
- State polling does not block PR creation
- UI updates reflect GitHub state within 30 seconds (polling interval)
- PR state transitions are monotonic: `draft` → `running-checks` →
  `ready-for-review` or `checks-failed`

### Scenario 2: CI Failure Detected, Agent Auto-Fixes

**Actor:** Agent (via scheduled job or MCP tool)

**Flow:**
1. PR is created and fails a linter check
2. Polling detects failure and updates task state to `checks-failed`
3. Agent queries `get_pr_status` → sees check failures listed
4. Agent logs task state in memory: `pr_status: checks-failed, reason: linter, file: src/index.ts`
5. Agent spawns Claude Code headless, fixes the linter error, pushes commit to branch
6. Polling detects new commit, re-runs checks
7. Checks pass, polling updates task to `ready-for-review`
8. Agent memory notes: `auto-fixed: linter, pr now passing`
9. GitHub Issue gets comment: "Fixed linter errors. PR is now ready for review."

**Acceptance Criteria:**
- `get_pr_status` includes detailed check failures (name, URL, message)
- Polling updates task state on every commit push (within 30 seconds)
- Task state transitions trigger via polling, not webhook
- Memory integration captures PR state snapshots for agent reasoning

### Scenario 3: PR Awaiting Review, Developer Gets Notified

**Actor:** Developer (implicit via Lore UI / Issue updates)

**Flow:**
1. PR is ready for review but has not been approved yet
2. Polling detects PR status is `ready-for-review` (checks passing,
   no merge conflicts)
3. Task shows state as `awaiting-review` in UI
4. GitHub Issue gets comment: "Ready for review — waiting on approval."
5. Developer can see in the UI: "Awaiting review from @alice" (or similar)
6. Reviewer approves PR
7. Polling detects approval, task shows `approved`
8. GitHub Issue gets comment: "Approved by @alice. Ready to merge."

**Acceptance Criteria:**
- Task state includes explicit `awaiting-review` status
- GitHub Issue comments update on state transitions
- PR state includes review status (requested, approved, changes-requested)
- Polling detects approvals within 30 seconds

### Scenario 4: PR Merged Successfully

**Actor:** Lore system

**Flow:**
1. PR is approved and auto-merged (or manually merged by reviewer)
2. Polling detects merge
3. Task state becomes `merged`
4. GitHub Issue is closed (if still open)
5. Agent marks task complete in memory: `pr_status: merged`

**Acceptance Criteria:**
- Polling detects merge within 30 seconds
- Task state reflects `merged`
- GitHub Issue is automatically closed with comment linking merged PR
- Merged status persists in task history for analytics

## Functional Requirements

### MCP Tools

1. **`get_pr_status(repo, pr_number)`**
   - Returns: `{ status, html_url, author, created_at, updated_at,
     checks[], reviews[], merge_status }`
   - Status enum: `draft`, `ready-for-review`, `checks-failed`,
     `merge-conflict`, `awaiting-review`, `approved`, `changes-requested`,
     `merged`, `closed`
   - Checks array: `[{ name, status, url, description }, ...]`
   - Reviews array: `[{ author, state, submitted_at, body }, ...]`
   - merge_status: `{ mergeable, can_be_auto_merged, method }`
   - Error handling: If PR not found, return gracefully with `status: unknown`

2. **`list_pr_status_for_task(task_id)`**
   - Returns PR status for all PRs associated with a task
   - Handles: feature PRs, spec PRs, onboarding PRs
   - Returns empty array if task has no PR or PR not yet created

3. **`subscribe_to_pr_updates(repo, pr_number, callback_url)`** (optional Phase 1)
   - Allows agents to register for webhook-style notifications
   - Falls back to polling if webhooks unavailable
   - Not required for Phase 0

### Data Schema

**pipeline.tasks** (existing table, add columns):
- `pr_number` (nullable int) — GitHub PR number if task created a PR
- `pr_status` (enum) — cached PR state from last poll
- `pr_last_checked` (timestamp) — when we last polled GitHub
- `pr_checks` (jsonb) — array of check results from last poll
- `pr_reviews` (jsonb) — array of reviews from last poll
- `pr_state_history` (jsonb) — snapshot of state transitions for analytics

**memory.memories** (existing, agent-created):
- Agents write memories like: `key: pr_block_reason, content: "linter
  failed on src/index.ts line 42"` when they detect a failure. Helps
  agents remember why they auto-fixed something.

### Polling

**Trigger:** Polling happens on:
1. **Task creation** — immediately poll the PR (if it exists)
2. **MCP call** — `get_pr_status` triggers a live poll
3. **Scheduled job** — every 30 seconds for all tasks with active PRs
   (GKE Lore Agent runs `scan_pr_states` CronJob)
4. **Push detection** — if repo has push ingestion webhook, trigger
   poll immediately (Phase 1)

**Implementation:**
- Poll via GitHub REST API (Octokit) — `GET /repos/{owner}/{repo}/pulls/{number}`
- Poll includes: commits, statuses, check runs, reviews
- Deduplicate: only write to DB if state changed (monotonic transitions)
- Rate limit: batch into 100-per-minute to stay well under GitHub limit
- Fallback: if GitHub API unavailable, use cached state + retry after 60s

### UI Updates

1. **Task view** — Show PR status card:
   ```
   PR Status: Ready for Review ✓
   Link: https://github.com/re-cinq/my-service/pull/42
   Checks: All passing (9/9)
   Review: Awaiting approval (0/1)
   ```

2. **PR state icon** — In task list:
   ```
   [✓] Feature task — PR: draft → ready ✓ (awaiting review)
   [×] Gap-fill task — PR: checks-failed (linter)
   [→] Spec task — PR: merged ✓
   ```

3. **GitHub Issue updates** — Every state change gets a comment:
   ```
   PR Status: Running checks
   Checks: linter (in progress)...
   ```

### State Transition Logic

**Valid transitions** (guard against nonsensical states):
```
draft → ready-for-review
       → checks-failed
       → merge-conflict
       → awaiting-review
awaiting-review → approved
                → changes-requested
                → ready-for-review (if reviewer dismissed their review)
approved → merged
         → closed
checks-failed → ready-for-review (after new commit fixes checks)
              → closed
```

**State determination algorithm:**
```
if pr.merged_at:
  return 'merged'
if pr.draft:
  return 'draft'
if pr.head.sha has failing checks:
  return 'checks-failed'
if not pr.mergeable:
  return 'merge-conflict'
if any review.state == 'changes-requested':
  return 'changes-requested'
if any review.state == 'approved' and checks passing:
  return 'approved'
if checks passing and no reviews yet:
  return 'ready-for-review'
if reviews pending:
  return 'awaiting-review'
if closed but not merged:
  return 'closed'
default:
  return 'awaiting-review'
```

## Non-Functional Requirements

### Performance

- `get_pr_status` MCP call completes in <500ms (cached data + 1 live poll)
- Polling job processes 100 PRs per minute (batch API calls)
- Dashboard loads task list with PR status in <2s (server-side cache)
- No polling for closed or merged PRs (optimization)

### Reliability

- Polling is idempotent (safe to run multiple times)
- Missed polls do not corrupt state (next poll corrects it)
- GitHub API errors do not block task creation or updates
- Graceful degradation: show cached state if API unavailable
- Audit trail: all state transitions logged to `pipeline.tasks.pr_state_history`

### Scalability

- Polling scales to 10k active PRs (batched API calls, indexes on
  `pr_last_checked`)
- Memory usage: <100MB for polling state across all tasks
- Database: add index on `pipeline.tasks(pr_number, repo_id)` for
  fast lookups

### Security

- No new credentials needed (use existing GitHub App token)
- No user PRs exposed via MCP (filter to repos developer can access)
- Rate limiting: built-in via GitHub API limits, Lore batches internally
- Audit: all polling logged to `audit_log` for compliance

## Out of Scope

1. **Webhook integration** — Phase 1. Polling is sufficient for Phase 0.
2. **Manual PR state override** — No "force merge" or fake state. Only
   GitHub is the source of truth.
3. **PR comment parsing** — Agents do not parse human review comments to
   extract structured feedback. That's Phase 2 (structured reviews).
4. **Auto-merge** — Decision on when to merge is out of scope. Agents
   react to approvals but do not auto-merge without explicit config.
5. **Review delegation** — No assignment of reviewers. That's existing
   GitHub workflows.
6. **Merge strategy** — No squash/rebase/fast-forward logic. Use GitHub
   defaults.

## Key Entities

### Data Model (minimal diff)

```sql
-- Add to pipeline.tasks:
ALTER TABLE pipeline.tasks ADD COLUMN pr_number INT;
ALTER TABLE pipeline.tasks ADD COLUMN pr_status VARCHAR(50);
ALTER TABLE pipeline.tasks ADD COLUMN pr_last_checked TIMESTAMP;
ALTER TABLE pipeline.tasks ADD COLUMN pr_checks JSONB;
ALTER TABLE pipeline.tasks ADD COLUMN pr_reviews JSONB;
ALTER TABLE pipeline.tasks ADD COLUMN pr_state_history JSONB;

CREATE INDEX idx_tasks_pr_status ON pipeline.tasks(pr_status) WHERE pr_status IS NOT NULL;
CREATE INDEX idx_tasks_pr_last_checked ON pipeline.tasks(pr_last_checked);

-- No new tables. Use existing memory table for agent memories.
```

### PR State Enum

```typescript
type PRStatus =
  | 'draft'
  | 'ready-for-review'
  | 'checks-failed'
  | 'merge-conflict'
  | 'awaiting-review'
  | 'approved'
  | 'changes-requested'
  | 'merged'
  | 'closed'
  | 'unknown'; // API error or PR not found
```

### Message Flow

```
Task created → agent creates PR → task polls get_pr_status
                                → updates pr_number, pr_status
                                → GitHub Issue comment: "Created PR #42"
                                      ↓
        Polling job runs every 30s → detects state change
                                → updates pr_status in DB
                                → GitHub Issue comment: "PR Status: ready-for-review"
                                      ↓
        Agent queries get_pr_status → reads from cache + live poll
                                → decides if auto-fix is needed
                                → writes memory about blocker
                                      ↓
        Developer sees in UI → PR Status card in task view
                           → Green checkmark if approved/merged
                           → Red X if checks failed
```

## Success Criteria

1. **Adoption** — At least 80% of agent-created PRs have PR status
   visible in UI within 24 hours of launch
2. **Latency** — PR state updates appear in UI within 30 seconds of
   GitHub state change
3. **Accuracy** — PR state in Lore matches GitHub state 99.9% of the time
   (measured by periodic reconciliation)
4. **Agent Usage** — At least 5 agent auto-fixes triggered by
   `get_pr_status` detecting failures in first month
5. **Developer Satisfaction** — Post-launch survey shows >80% of
   developers say "I no longer context-switch to GitHub to check PR
   status"
6. **System Health** — Polling job runs successfully 99.9% of the time,
   no dropped PR state updates

## Assumptions

1. **GitHub API is reliable** — We assume <1% downtime. If down, we use
   cached state.
2. **PR numbers are stable** — Assumption: PR numbers do not change,
   used as immutable key.
3. **Developers use GitHub as primary PR interface** — Spec assumes
   PRs are approved/merged via GitHub, not via Lore (yet). Lore is
   read-mostly for state.
4. **Polling interval is sufficient** — 30-second polling catches all
   practical state changes (CI, reviews, merges).
5. **Agents can write memory** — Assumption: agent memory works and is
   queryable by future agent runs.
6. **No new GitHub App permissions needed** — We use existing GitHub
   App token with PR read access already configured.