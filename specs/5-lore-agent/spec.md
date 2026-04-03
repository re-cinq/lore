# Feature Specification: Lore Agent Service

| Field          | Value                                       |
|----------------|---------------------------------------------|
| Feature        | Lore Agent Service                          |
| Branch         | 5-lore-agent                                |
| Status         | Shipped                                     |
| Created        | 2026-03-29                                  |
| Owner          | Platform Engineering                        |

## Problem Statement

Lore's pipeline currently delegates tasks to Klaus, a third-party
agent runtime. This creates multiple pain points:

1. **Black-box output format** — Klaus wraps agent output in
   unpredictable layers (`result_text` JSON, markdown code fences),
   causing parsing failures when creating PRs from agent work.

2. **No repo access** — Klaus cannot inspect target repositories,
   requiring complex pre-fetch workarounds in the pipeline.

3. **Model inflexibility** — Klaus rejects model parameters and
   doesn't reliably use configured model env vars, forcing expensive
   Sonnet usage for tasks that Haiku handles well.

4. **Session fragility** — Klaus's MCP session protocol requires
   initialization, polling, and reconnection logic. Pod restarts
   lose in-flight task callbacks.

5. **Scattered scheduling** — Periodic jobs (reindex, gap detection,
   spec drift, merge checks, TTL cleanup) are split across K8s
   CronJobs and polling loops inside the MCP server, making them
   hard to monitor and maintain.

The result: onboarding a single repo has required 7+ manual
retries due to output parsing failures, empty responses, and
race conditions.

## Vision

A single, purpose-built agent service that:

- Calls the LLM API directly with full control over model, prompt,
  and response parsing
- Processes all pipeline tasks reliably — from onboarding to
  code review to gap-fill
- Runs all scheduled maintenance jobs from one place
- Produces clean, predictable output that the PR creation pipeline
  can parse on the first attempt
- Is observable: every task run, scheduled job, and LLM call is
  logged with cost, duration, and outcome

## User Personas

### Platform Engineer

Deploys and monitors the agent service. Needs visibility into task
processing, scheduled job runs, LLM costs, and failure rates.
Configures task types and schedules.

### Developer

Creates pipeline tasks (via UI or MCP tools) and expects them to
be picked up, processed, and turned into PRs within minutes.
Shouldn't need to know about the agent service — it just works.

### Product Owner

Reviews agent-generated PRs. Expects onboarding PRs to contain
accurate, repo-specific content (not empty files or raw output
dumps). Expects tasks to complete on the first try.

## User Scenarios & Acceptance Criteria

### Scenario 1: Pipeline Task Processing

**Actor:** Developer (indirect — creates task via UI)

**Flow:**
1. Developer creates a pipeline task (e.g., "onboard re-cinq/my-service")
2. Task appears as "pending" in the pipeline dashboard
3. Agent service picks up the task within 30 seconds
4. For onboard tasks: agent pre-fetches repo tree and key files
5. Agent calls LLM with the prompt template and context
6. Agent parses the structured response
7. Agent creates a branch, commits files, and opens a PR
8. Task status moves to "pr-created" with a link to the PR
9. PR contains all expected files (not a single output dump)

**Acceptance Criteria:**
- Tasks move from pending to pr-created without manual intervention
- Onboarding PRs contain individual files (CLAUDE.md, ADRs, etc.), not a single output file
- Task processing completes within 5 minutes for standard tasks
- Failed tasks show a clear error message in the pipeline dashboard
- No tasks are lost during agent service restarts

### Scenario 2: Scheduled Maintenance Jobs

**Actor:** Platform Engineer (configures), System (executes)

**Flow:**
1. Agent service starts and loads the job schedule
2. At 2:00 AM daily: re-indexes context for all onboarded repos
3. At 9:00 AM Monday: runs gap detection across all repos
4. At 10:00 AM Monday: checks for spec drift
5. Every 60 seconds: checks for merged onboarding PRs
6. Every hour: cleans up expired memory entries
7. Each job run is logged with start time, duration, and outcome
8. Failed jobs are retried once, then logged as failed

**Acceptance Criteria:**
- All 5 scheduled jobs run at their configured times
- Job runs are visible in the system (logs or dashboard)
- A missed schedule (e.g., service was down) runs the job on next startup
- Jobs do not overlap — a long-running job delays the next occurrence rather than running concurrently

### Scenario 3: Observability and Cost Tracking

**Actor:** Platform Engineer

**Flow:**
1. Engineer checks the pipeline dashboard or service logs
2. Each completed task shows: LLM model used, token count, cost, duration
3. Scheduled job history shows: last run time, outcome, duration
4. Service health endpoint reports: uptime, tasks processed today, last job run times

**Acceptance Criteria:**
- Every LLM call is logged with model, input/output tokens, and cost
- Daily cost is trackable per task type
- Service exposes a health endpoint with operational metrics
- Task failures include the LLM response (or error) for debugging

### Scenario 4: Graceful Handling of Edge Cases

**Actor:** System

**Flow:**
1. Agent receives a task for a repo that doesn't exist → task fails with clear error
2. LLM returns malformed output → agent retries once with a simplified prompt, then fails with the raw output attached
3. GitHub API rate limit hit → agent backs off and retries after the reset window
4. Service restarts while a task is running → task is reset to pending on next startup (no stuck "running" tasks)
5. Database connection lost → agent pauses processing, reconnects, resumes

**Acceptance Criteria:**
- No tasks remain stuck in "running" state indefinitely
- Stale running tasks (older than the task type timeout) are automatically recovered
- GitHub API errors include the HTTP status and rate limit reset time
- LLM errors include the model name and error message

### Scenario 5: Feature Request (PM Intent → Spec)

**Actor:** Product Manager

**Flow:**
1. PM opens the Lore UI and navigates to a repo
2. Creates a new task with type "Feature Request"
3. Describes the feature in plain language (e.g., "I want users to export timesheets as PDF")
4. Agent fetches repo context (CLAUDE.md, existing specs, ADRs)
5. Agent generates spec.md, data-model.md, and tasks.md matching the repo's conventions
6. Agent opens a PR labeled [spec] [needs-review]
7. Engineer reviews the spec, refines, and merges
8. Engineer runs speckit workflow to plan and implement

**Acceptance Criteria:**
- PM can create a feature request using plain language without knowing speckit, MADR, or any engineering conventions
- Generated spec follows the same format as existing specs in the repo
- Generated tasks include file paths matching the actual project structure
- PR is clearly labeled for engineer review before implementation begins
- Each artifact (spec, data model, tasks) is committed as a separate file, not a single dump

## Functional Requirements

### FR-1: Task Polling and Processing

The service polls for pending pipeline tasks and processes them
sequentially (one at a time, to control costs and avoid race
conditions). Each task goes through: pickup → LLM call → output
parsing → PR creation → status update.

### FR-2: Direct LLM Integration

The service calls the LLM provider API directly. The model is
configurable per task type (defaulting to the most cost-effective
model). Prompts are built from task-types.yaml templates with
variable substitution.

### FR-3: Repo Context Pre-Fetch

For onboard and implementation tasks, the service fetches the
target repo's structure and key files before calling the LLM.
This context is included in the prompt so the LLM can generate
accurate, repo-specific output.

### FR-4: Structured Output Parsing

The service expects JSON output from onboard tasks (`{ "files": {...} }`)
and creates individual file commits from the parsed structure. If
parsing fails, it retries once with a more explicit prompt. On second
failure, it creates a single-file PR with the raw output for human
review.

### FR-5: PR Creation Pipeline

The service creates branches, commits files, and opens PRs on target
repos using an authenticated GitHub integration. Onboard PRs contain
individual files. Other task types produce a single output file.

### FR-6: Job Scheduling

The service runs periodic maintenance jobs on configurable schedules:

| Job                     | Default Schedule     | Description                                    |
|-------------------------|----------------------|------------------------------------------------|
| Context reindex         | Daily at 2:00 AM     | Re-embed changed content for all onboarded repos |
| Gap detection           | Monday at 9:00 AM    | Identify missing context across repos          |
| Spec drift check        | Monday at 10:00 AM   | Compare specs against actual code              |
| Onboarding PR merge     | Every 60 seconds     | Detect merged onboarding PRs, trigger ingestion |
| Memory TTL cleanup      | Every hour           | Remove expired memory entries                  |

### FR-7: Crash Recovery

On startup, the service checks for tasks stuck in "running" or
"queued" state that are older than their configured timeout. These
tasks are reset to "pending" for reprocessing.

### FR-8: Health and Metrics

The service exposes a health endpoint reporting: service uptime,
tasks processed (today/total), last scheduled job run times, and
current task (if any). LLM calls are logged with model, tokens,
cost, and duration.

### FR-9: Feature Request Translation

The service accepts plain-language feature descriptions from product managers and generates structured engineering artifacts: a specification (spec.md), data model changes (data-model.md), and task breakdown (tasks.md). The agent fetches the target repo's context to match existing conventions. Each artifact is generated with a separate focused LLM call and committed individually to a PR.

### FR-10: Claude Code Headless Execution

For complex tasks (implementation, refactoring), the service can spawn a headless Claude Code process with full tool access. The agent clones the target repo, runs `claude --print` in the repo directory, commits all changes, and creates a PR. This mode is used when the `claude` CLI is available and the task type has `execution_mode: claude-code`.

### FR-11: Local Task Delegation

When the MCP server runs locally without database access, the `create_pipeline_task` tool proxies task creation to the GKE MCP server via HTTP. Developers can delegate work from their terminal without infrastructure.

### FR-12: Automatic Ingest Configuration

After creating an onboarding PR, the agent automatically sets `LORE_INGEST_TOKEN` (encrypted secret) and `LORE_INGEST_URL` (variable) on the target repo via the GitHub API. This ensures the `lore-ingest.yml` workflow works immediately after the onboarding PR is merged.

### FR-13: GitHub Issue Sync

When processing a task, the service creates a GitHub Issue on the target repo to make the work visible to developers. The issue:
- Is created when the agent picks up the task, with description, type, and creator
- Gets comments on status changes (agent assigned, PR created, failure)
- References the PR via `Refs #issue` in the PR body
- Is closed as completed when the PR is created, or left open with a `lore-failed` label on failure
- Uses the `lore-managed` label for filtering

If the GitHub App lacks Issues permission on a repo, the task proceeds without an issue.

### FR-14: Review Reactor

The service monitors agent-generated PRs for human review feedback every 5 minutes. When "changes requested" reviews or new comments are detected after the last commit, the agent assembles context (PR diff + review comments + repo conventions), calls the LLM to generate fixes, and commits corrections to the existing branch. Maximum 3 iterations per PR before escalating with a `needs-human` label. Review corrections are stored in agent memory for future tasks on the same repo.

### FR-15: Platform Abstraction

All code platform operations (branches, commits, PRs, issues, repo content, secrets) go through a `CodePlatform` interface. GitHub is the only implementation today. Adding another platform (GitLab, Bitbucket) requires implementing the interface — no changes to the worker, jobs, or any other module.

### FR-16: Optional Approval Gates

The service supports an optional human approval step before processing tasks. When enabled (globally or per-repo), tasks enter an `awaiting_approval` status instead of `pending`. The agent comments on the GitHub Issue with instructions to add an `approved` label. A scheduled job checks for the label every minute and transitions approved tasks to `pending`. Task types listed as "auto-approve" (default: general, gap-fill) skip the gate. Configuration is managed via the settings UI.

### FR-17: Org-Wide Memory Sharing

When the MCP server runs locally without database access, all memory operations (write, read, search, delete, list) are proxied to the GKE MCP server via HTTP. A developer's learnings stored via `write_memory` are immediately searchable by every other developer in the org. File-backed fallback is used only when the proxy is unreachable.

## Non-Functional Requirements

- **Availability:** Service should recover from crashes within 60
  seconds (container restart policy)
- **Cost control:** Default to the most cost-effective LLM model;
  operator can override per task type
- **Concurrency:** Process one task at a time to prevent cost spikes
  and simplify error handling
- **Isolation:** Service runs in its own container with dedicated
  credentials; no shared process with the MCP server

## Out of Scope

- Multi-tenant task isolation (all tasks share one agent)
- Interactive agent sessions (this is batch processing only)
- Multi-model routing (all tasks use a single configured model per type)
- Migration of existing Klaus-processed tasks

## Key Entities

### Task (existing)

Represents a unit of work in the pipeline. Fields: id, description,
task_type, target_repo, status, agent_id, pr_url, context_bundle,
failure_reason, review_iteration, created_at.

### Job Run (new)

Represents one execution of a scheduled job. Fields: job_name,
started_at, completed_at, status (running/completed/failed),
result_summary, error.

### LLM Call Log (new)

Represents one call to the LLM API. Fields: task_id (nullable),
job_name (nullable), model, input_tokens, output_tokens, cost_usd,
duration_ms, created_at.

### Issue Sync (added to existing Task entity)

Additional fields on pipeline.tasks: issue_number (INT, nullable), issue_url (TEXT, nullable), actor (TEXT, nullable — tracks who/what created the task).

## Success Criteria

1. Onboarding a new repo produces a multi-file PR on the first
   attempt (no manual retries needed) within 5 minutes
2. All 5 scheduled maintenance jobs run reliably without K8s
   CronJob configuration
3. LLM costs per onboarding task are under $0.10 (using the
   cost-effective model)
4. Zero tasks are lost or stuck during normal service restarts
5. Platform engineers can see task processing history, LLM costs per task, and daily cost totals in the web UI
6. The service processes a backlog of 10 pending tasks within
   60 minutes
7. Product managers can create feature requests in plain language
   and receive a spec PR within 10 minutes
8. Developers can delegate tasks from local Claude Code to the GKE pipeline without any infrastructure setup
9. Human review feedback on agent PRs is addressed automatically within 10 minutes
10. Developers get repo-specific context automatically when opening Claude Code — no manual loading needed
11. Any developer's memory writes are immediately searchable by every other developer in the org

## Assumptions

- The existing pipeline.tasks table schema is sufficient (no
  schema migration needed for core task processing)
- The GitHub App installation has access to all onboarded repos
- LLM API keys are provided via environment variables or secrets
- The service runs as a single replica (no horizontal scaling
  needed for current task volume)
- Scheduled job times are configured via environment variables
  or a config file, not the database
- The MCP server continues to handle task CRUD (create, list,
  cancel) — the agent service only processes them

## Dependencies

- Existing PostgreSQL database with pipeline and lore schemas
- GitHub App credentials (app ID, private key, installation ID)
- LLM API key (Anthropic)
- Vertex AI access for embedding generation (reindex job)
- task-types.yaml for prompt templates
