# Feature Specification: Task State Filter

| Field             | Value                                      |
|-------------------|--------------------------------------------|
| Feature           | Task State Filter                          |
| Branch            | i-want-to-have-a-task-state-fi             |
| Status            | Draft                                      |
| Created           | 2026-03-25                                 |
| Owner             | Platform Engineering                       |
| Phase 0 Target    | 2-3 working days                           |
| Full Stack Target | 3-4 weeks                                  |

## Problem Statement

Developers and platform engineers viewing the pipeline dashboard see all
tasks in a flat list. As task volume grows (100+ concurrent tasks across
repos), finding what matters becomes difficult: Is my implementation task
still pending? Has the gap-fill I triggered started? Are there stuck
tasks blocking my team? Without filters, the dashboard becomes noise.
Teams spend time scrolling and squinting instead of getting signal on
task state.

## Vision

The pipeline dashboard has a task state filter UI. Developers can filter
by status (pending, running, completed, failed, blocked), task type
(feature-request, onboard, implementation, gap-fill, review, runbook),
repo ownership (my repos, team repos, all repos), and progress (active
in last hour, active in last day, not started). Results update instantly.
Filters persist in URL query params so team members can share filtered
views. The default view is "my tasks, last 7 days, all statuses" — focused
by default but not restrictive.

## User Personas

### Active Developer

A developer working on a feature. They want to see: their claimed tasks,
any blockers, and which tasks are now unblocked (dependents ready for work).
They filter by status=claimed and task_type=implementation to see only what
they're working on. If a dependency is completed, they want to know
immediately without refreshing.

### Platform Engineer

An ops engineer monitoring scheduled jobs (reindex, gap-detect, spec-drift,
eval-runner). They want to see: which jobs ran today, how many failed, and
why. They filter by status=failed, created_since=24h to spot problems.

### Tech Lead

A tech lead reviewing the org's spec and documentation coverage. They want
to see all gap-fill tasks in progress and completed in the last week. They
filter by task_type=gap-fill, status=running|completed, created_since=7d
to track coverage improvements.

### PM / Product Manager

A PM who triggered feature requests and wants to see spec generation status.
They filter by task_type=feature-request, status=pending|running to watch
for their specs to be ready.

## User Scenarios & Acceptance Criteria

### Scenario 1: Developer Filters Own Tasks

**Actor:** Active Developer

**Flow:**
1. Developer opens `lore.gcp.re-cinq.com/pipeline`
2. Default view shows tasks from past 7 days (all statuses)
3. Developer clicks the "Status" filter dropdown
4. Checks "claimed" and "running"
5. Page updates instantly — shows only their claimed/running tasks
6. Developer sees a task marked "blocked-on-dependency"
7. They check the related task — it's now "completed"
8. They click "unblock" to mark the blocker resolved
9. The task moves from "blocked" to "pending-claimed"
10. URL updates to `?status=claimed,running&claimed_by=<agent-id>`
11. Developer can share this URL with teammates to show their work

**Acceptance Criteria:**
- Filter UI appears on the pipeline page
- Multiple status values can be selected
- Results update within 200ms of filter change
- URL query params reflect selected filters
- Sharing a filtered URL loads the same view for others
- No page reload needed when filters change
- Default view is `created_since=7d` with all statuses
- Developers can see "blocked on" relationships in the task row

### Scenario 2: Platform Engineer Monitors Failed Jobs

**Actor:** Platform Engineer

**Flow:**
1. Engineer opens `lore.gcp.re-cinq.com/pipeline`
2. Clicks the "Status" filter, selects "failed"
3. Clicks the "Task Type" filter, selects "reindex", "gap-detect", "eval-runner"
4. Clicks "Time Range" filter, selects "last 24 hours"
5. See 3 failed eval-runner tasks
6. Click on one task to see the error log and retry button
7. Retry the task
8. Refresh view — task moves to "pending" status
9. Can set an alert: "notify me if any task type= [scheduled] fails"

**Acceptance Criteria:**
- Three independent filter dropdowns (Status, Task Type, Time Range)
- Can multi-select within each filter
- Results update instantly
- Failed tasks show error summary in the list row
- Clicking a task opens a detail panel with full logs
- Retry button is present for failed tasks
- URL includes all active filters: `?status=failed&task_type=reindex,gap-detect,eval-runner&created_since=24h`
- Users can save filter presets (optional Phase 1)

### Scenario 3: Tech Lead Tracks Documentation Coverage

**Actor:** Tech Lead

**Flow:**
1. Tech lead opens `lore.gcp.re-cinq.com/pipeline`
2. Filters: task_type=gap-fill, status=running|completed, created_since=7d
3. Sees 12 gap-fill tasks completed in the past week across 4 repos
4. Clicks on repo filter to see just `re-cinq/platform` (their domain)
5. Sees 3 gap-fill tasks completed for that repo
6. Each task row shows which doc was generated (e.g., "Generated ADR-012-error-handling.md")
7. Can generate a summary report: "7-day gap-fill activity"

**Acceptance Criteria:**
- Task type filter supports multiple selections
- Status filter supports OR logic (running OR completed)
- Time range filter supports "created_since" and "updated_since"
- Repo filter appears and lets users filter by repo ownership
- Task rows show "artifact" or "output" summary
- Can export task list as CSV for reporting
- URL reflects all filters: `?task_type=gap-fill&status=running,completed&created_since=7d&repo=re-cinq/platform`

### Scenario 4: PM Monitors Spec Generation

**Actor:** PM

**Flow:**
1. PM opens Lore dashboard, goes to pipeline
2. Filters: task_type=feature-request
3. Sees all 5 feature requests in the system
4. Three are "completed" (spec ready for review)
5. Two are "running" (spec generation in progress, 60% done)
6. PM clicks on a "completed" task to see the PR link
7. Clicks link to review the generated spec
8. Can bulk-select multiple completed specs and get a summary

**Acceptance Criteria:**
- Feature-request task type is filterable
- Progress indicators visible for running tasks
- Completed tasks show PR link in the task row
- Can click through to the PR directly from the dashboard
- Sorting by "status" or "created_at" works
- Task row shows the PM's original intent text (first 80 characters)

## Functional Requirements

1. **Filter UI Component** (React)
   - Dropdown menu for "Status" (single or multi-select)
   - Dropdown menu for "Task Type" (single or multi-select)
   - Dropdown menu for "Time Range" (single select: today, 7d, 30d, all)
   - Dropdown menu for "Repo" (searchable, default="my repos" or "all")
   - Dropdown menu for "Claimed By" (searchable, shows agent IDs / names)
   - Clear all filters button
   - "Save filter preset" button (Phase 1, optional)

2. **Filter State Management**
   - Filters stored in URL query params for shareability
   - On page load, parse query params and restore filter state
   - On filter change, update URL without page reload (history.pushState)
   - Default values: created_since=7d, status=all, task_type=all, repo=my_repos

3. **Backend Query Support** (MCP tool or REST API)
   - `list_pipeline_tasks` MCP tool modified to accept filter parameters:
     - `status?: string[]` (e.g., ["pending", "running", "completed", "failed", "blocked"])
     - `task_type?: string[]` (e.g., ["feature-request", "onboard", "implementation"])
     - `created_since?: number` (hours before now; 0=all)
     - `repo?: string` (filter to specific repo; null=all)
     - `claimed_by?: string` (agent ID or "me")
     - `page?: number`, `limit?: number` (pagination)
   - Return paginated results with total count and filter summary
   - All filters are AND'd together (except status and task_type which are OR'd internally)

4. **Task Status Values** (enum in database)
   - pending: task created, not yet claimed or scheduled
   - pending-claimed: task claimed by a developer, awaiting start
   - running: task currently executing
   - completed: task finished successfully, PR created
   - failed: task failed, error logged
   - blocked: task blocked on a dependency
   - cancelled: task cancelled by user or TTL exceeded

5. **Task Type Values** (enum in database)
   - feature-request: PM intent → spec generation
   - onboard: new repo onboarding
   - implementation: spec → code (ephemeral Job pod)
   - gap-fill: documentation gap → draft
   - review: PR review against spec
   - runbook: incident response playbook generation
   - general: open-ended task

6. **Pagination**
   - Default limit: 25 tasks per page
   - Show "page X of Y" in footer
   - Next / Previous buttons
   - Jump-to-page input (optional)
   - Results show "Showing 1-25 of 127 tasks"

7. **Real-time Updates** (optional Phase 1)
   - Websocket connection to pipeline service
   - Task status changes push to UI (task moves from "running" to "completed")
   - No polling — instant updates
   - Visual indicator when a task status changes (highlight, toast)

8. **Task Row Display**
   - Task ID (short hash or sequential number)
   - Task type (badge: feature-request, onboard, implementation, etc.)
   - Status (badge: pending, running, completed, failed, blocked)
   - Repo (owner/name)
   - Created timestamp (relative: "2 hours ago")
   - Progress bar (if running) or completion status
   - PM intent / task description (80 chars, truncated)
   - Claimed by (agent ID or user name)
   - PR link (if completed)
   - Error summary (if failed) — tooltip on hover

9. **Sorting**
   - Sort by: Created (desc), Updated (desc), Status (A-Z), Type (A-Z)
   - Default: Created (newest first)
   - Sort button in each column header (classic table UI)

10. **Export** (Phase 1, optional)
    - Export filtered results as CSV (task ID, type, status, repo, created, updated, claimed_by, pr_link)
    - One-click download

## Non-Functional Requirements

### Performance

- Filter UI renders within 100ms
- Filter change produces results within 200ms (sub-second perceived latency)
- Query for 1000 tasks with filters completes in <500ms
- URL updates happen synchronously (no jank)
- Pagination works smoothly even with 10,000+ total tasks in the system

### Database

- Index on (status, created_at) for efficient filtering
- Index on (task_type, status) for rapid faceting
- Index on (repo_id, status) for repo-specific views
- Index on (claimed_by, status) for developer-focused views
- Queries use LIMIT + OFFSET for pagination

### Accessibility

- Filter dropdowns keyboard-accessible (arrow keys, Enter)
- Filter labels associated with inputs (for screen readers)
- Active filters visually distinct (color, checkmark, pill-style badges)
- Filter count badge shows number of active filters
- Tab order: Status → Task Type → Time Range → Repo → Claimed By → Clear All

### Security

- Developers can only filter by `claimed_by=me` (enforced server-side)
- No filters expose org secrets or sensitive task data
- Filter parameters validated server-side; malformed filters ignored gracefully

## Out of Scope

- **Real-time websocket updates** (Phase 1)
- **Save filter presets / favorites** (Phase 1)
- **Advanced query syntax** (e.g., `status:failed AND task_type:gap-fill`) — UI-driven filters only
- **Analytics / trend charts** on filtered data (separate feature)
- **Bulk operations** on filtered tasks (e.g., "retry all failed") — Phase 1
- **Filter on custom fields** (e.g., task cost, duration) — Phase 1
- **Full-text search across task descriptions** — use MCP `search_context` for that
- **Archive / delete tasks** — tasks are immutable
- **Reassign tasks** — task reassignment out of scope for this feature

## Key Entities

### Task Model (PostgreSQL)

```sql
CREATE TABLE pipeline.tasks (
  id UUID PRIMARY KEY,
  repo_id UUID NOT NULL REFERENCES lore.repos(id),
  task_type VARCHAR(32) NOT NULL, -- feature-request, onboard, implementation, etc.
  status VARCHAR(32) NOT NULL, -- pending, running, completed, failed, blocked
  
  title TEXT,
  description TEXT,
  pm_intent TEXT, -- original intent from PM (feature-request only)
  
  claimed_by VARCHAR(128), -- agent ID or developer ID
  blocked_on UUID REFERENCES pipeline.tasks(id), -- dependency
  
  pr_link TEXT, -- GitHub PR URL (if completed)
  error_log TEXT, -- failure reason (if failed)
  
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  completed_at TIMESTAMP,
  
  created_by VARCHAR(128),
  
  INDEX idx_status_created (status, created_at DESC),
  INDEX idx_task_type_status (task_type, status),
  INDEX idx_repo_status (repo_id, status),
  INDEX idx_claimed_by_status (claimed_by, status),
  INDEX idx_created_since (created_at DESC)
);
```

### Filter Query Parameters

| Param | Type | Example | Default |
|-------|------|---------|---------|
| `status` | string[] | `?status=pending,running` | all |
| `task_type` | string[] | `?task_type=implementation,gap-fill` | all |
| `created_since` | number | `?created_since=24` (hours) | 168 (7 days) |
| `repo` | string | `?repo=re-cinq/my-service` | user's repos |
| `claimed_by` | string | `?claimed_by=me` or `?claimed_by=<agent-id>` | all |
| `page` | number | `?page=2` | 1 |
| `limit` | number | `?limit=50` | 25 |
| `sort_by` | string | `?sort_by=created` | created |
| `sort_order` | string | `?sort_order=desc` | desc |

## Success Criteria

1. **Discoverability** — filter UI is immediately visible on pipeline page (no hidden menu)
2. **Speed** — filter results return in <200ms; URL updates instantly
3. **Shareability** — filtered URLs can be copied and shared; teammates see the same view
4. **Defaults** — new developers see a sensible default view (my tasks, past week) without configuration
5. **Coverage** — all five filter dimensions (status, type, time, repo, claimed_by) are implemented
6. **Reliability** — malformed filters degrade gracefully (ignored, not 500 errors)
7. **Adoption** — within 2 weeks, >50% of pipeline dashboard viewers use at least one filter
8. **Feedback** — developers report filter feature in monthly usage surveys

### Measurable Outcomes

- Task list load time: <500ms for any filter combination (measure via Web Vitals)
- Filter interaction latency: <200ms from click to result update (measure via performance observer)
- URL sharability: 0 errors when teammate opens shared filter URL
- Default view adoption: 80% of sessions use default or single-filter view (not all-open view)

## Assumptions

1. **Task volume growth** — pipeline will reach 500+ concurrent tasks within 6 months, justifying filtering
2. **Team adoption** — developers will filter by `claimed_by=me` as a primary workflow (not just browse all)
3. **URL sharing** — teams will benefit from sharing filtered views (e.g., "here are all our blocked tasks")
4. **Database scale** — PostgreSQL can handle these indexes and queries at 10k+ tasks without significant latency
5. **No real-time requirement yet** — Phase 0 uses polling; websocket updates deferred to Phase 1
6. **Filter UI precedent** — developers are familiar with filter patterns from GitHub, Jira, Linear
7. **Status enum stability** — the 7 status values (pending, pending-claimed, running, completed, failed, blocked, cancelled) are stable and won't change frequently
8. **No cross-org filtering** — filtering operates within a single org's pipeline only (no multi-org queries)