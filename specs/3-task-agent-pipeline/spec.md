# Feature Specification: Task-to-Agent Pipeline

| Field          | Value                                       |
|----------------|---------------------------------------------|
| Feature        | Task-to-Agent Pipeline                      |
| Branch         | 3-task-agent-pipeline                       |
| Status         | Shipped                                     |
| Created        | 2026-03-29                                  |
| Owner          | Platform Engineering                        |

## Problem Statement

Today, tasks exist in two disconnected worlds. A product owner
creates a task in the Lore UI or a developer writes a spec — but
nothing happens until a human manually picks it up in Claude Code
and runs `/lore-feature`. Klaus agents run on schedules (nightly
reindex, weekly gap detection) but can't be triggered by a task
or a PR.

The missing link: when a task is created or a PR is opened, an
agent should automatically start working on it. The agent runs in
GKE as a Klaus container, does the work, and creates a PR for
human review. Platform engineers define *what* agents do; the
pipeline handles *when* they run.

## Vision

Any task created in Lore — via the UI, via the MCP tools, or via
a PR to the context repo — automatically spawns a Klaus agent on
GKE. The agent reads the task description, pulls relevant context
from Lore's memory and knowledge base, does the work (writes code,
drafts docs, generates specs), commits to a branch, and opens a PR.
A human or another agent reviews and merges.

The system is event-driven: task created → agent spawned → work
done → PR opened → review → merge. No polling, no manual
intervention between creation and review.

## User Personas

### Product Owner (non-developer)

Creates tasks via the Lore UI. Expects an agent to pick them up
within minutes. Wants to see progress in the UI and review the
result as a PR. Does not use Claude Code or the terminal.

### Developer

Creates tasks via Claude Code (`bd create`) or the MCP tools.
Delegates specific work items to the cluster. Expects results as
PRs they can review alongside their own code.

### Platform Engineer

Configures which task types trigger agents, what prompts they use,
and what repos they can access. Monitors agent runs via the UI
and audit trail.

## User Scenarios & Acceptance Criteria

### Scenario 1: UI Task → Agent → PR

**Actor:** Product Owner

**Flow:**
1. PO creates a task in the Lore UI: "Write a runbook for the
   new payment retry flow."
2. System detects the new task and spawns a Klaus agent.
3. Agent reads the task, pulls relevant context from Lore (payment
   team conventions, existing runbooks, ADRs).
4. Agent writes the runbook, commits to a branch, opens a PR.
5. PO sees the PR link in the UI and reviews it.

**Acceptance Criteria:**
- Agent starts within 2 minutes of task creation.
- PR includes the generated content with proper formatting.
- Task status updates visible in the UI (pending → running →
  pr-created).
- Agent uses Lore context (not generic knowledge).

### Scenario 2: Spec PR → Agent Implements

**Actor:** Developer

**Flow:**
1. Developer pushes a `.specify/spec.md` to a branch.
2. System detects the spec PR and spawns a Klaus agent.
3. Agent reads the spec, generates implementation plan and code.
4. Agent commits implementation to the same branch or a child
   branch.
5. Developer reviews the implementation alongside the spec.

**Acceptance Criteria:**
- Agent triggered by PR containing `.specify/` files.
- Implementation follows the spec's requirements.
- Agent commits are attributed (clear author, not the developer).
- Developer can iterate: push spec changes, agent re-runs.

### Scenario 3: MCP Tool → Agent

**Actor:** Developer (via Claude Code)

**Flow:**
1. Developer calls `delegate_task` with a task description.
2. Klaus agent starts on GKE with the context bundle.
3. Agent does the work and opens a PR.
4. Developer gets notified via `task_status`.

**Acceptance Criteria:**
- Same flow as existing `delegate_task` but always results in a PR.
- Context bundle (Beads task, spec, seed query) is passed through.
- Agent uses Lore memory to avoid repeating previous work.

### Scenario 4: Agent Reviews Agent

**Actor:** Platform Engineer (configures), system (executes)

**Flow:**
1. Agent A creates a PR (from Scenario 1, 2, or 3).
2. System detects the new PR and spawns Agent B as a reviewer.
3. Agent B reviews the code, checks against conventions, ADRs,
   and the original spec/task.
4. Agent B either approves or requests changes (as PR comments).
5. If changes requested, Agent A is re-triggered to address them.

**Acceptance Criteria:**
- Review agent is separate from implementation agent.
- Review checks against Lore context (not just syntax).
- At least one human must approve before merge (agent approval
  alone is not sufficient).
- Review comments are specific and actionable.

### Scenario 5: Task Progress Tracking

**Actor:** Any user (via UI or MCP)

**Flow:**
1. Task is created and agent is spawned.
2. User checks task status.
3. UI shows: task description, agent ID, start time, current
   status, PR link (when created).

**Acceptance Criteria:**
- Status transitions: pending → queued → running → pr-created →
  review → merged (or failed).
- Each transition is timestamped.
- Failed tasks show the failure reason.
- All status changes visible in both UI and via `task_status` MCP.

## Functional Requirements

### FR-1: Task Event Detection

The system MUST detect new tasks from multiple sources.

- FR-1.1: UI task creation triggers agent spawn via a polling loop
  in the MCP server (query pending tasks every 10 seconds). No
  database-specific event mechanisms — infra-agnostic so the system
  can be packaged and deployed anywhere.
- FR-1.2: PR with `.specify/` files triggers agent via GitHub
  webhook or Actions workflow.
- FR-1.3: `delegate_task` MCP tool triggers agent via Klaus HTTP
  endpoint (existing).
- FR-1.4: Event deduplication: same task does not spawn multiple
  agents.

### FR-2: Agent Spawning

The system MUST spawn Klaus agents in response to task events.

- FR-2.1: Each task gets a dedicated Klaus agent (one container
  per task).
- FR-2.2: Agent receives: task description, context bundle (Lore
  memory, relevant context chunks, spec if available), target
  repo + branch. Lore is one instance per org managing multiple
  repos. Target repo is required — defaults to the Lore context
  repo for context tasks, must be specified for code tasks (via
  task type config or task description).
- FR-2.3: Agent has GitHub access via a GitHub App installed on
  the org. Each agent run gets a short-lived installation token
  scoped to configured repos. No personal access tokens.
- FR-2.4: Agent has Lore MCP access (to search context, read/write
  memory).
- FR-2.5: Configurable timeout per task type (default: 30 minutes).
- FR-2.7: Maximum 5 concurrent agents. Tasks exceeding the limit
  queue in `pending` state until a slot opens. Configurable.
- FR-2.6: Agent runs with a unique agent ID (written to Lore
  memory for tracking).

### FR-3: Agent Work Output

The system MUST ensure agents produce reviewable output.

- FR-3.1: Agent creates a git branch named
  `agent/<task-id>/<short-description>`.
- FR-3.2: Agent commits work with clear commit messages.
- FR-3.3: Agent opens a PR with: summary of what was done,
  link to the original task, context used (ADRs, specs referenced).
- FR-3.4: PR is labelled `agent-generated` for filtering.
- FR-3.5: Agent updates task status to `pr-created` with PR link.

### FR-4: Review Pipeline

The system MUST support automated review of agent-generated PRs.

- FR-4.1: Configurable: agent PRs can trigger a review agent.
- FR-4.2: Review agent checks implementation against spec, ADRs,
  and team conventions from Lore.
- FR-4.3: Review agent posts comments on the PR.
- FR-4.4: Review agent can approve (but human approval still
  required for merge).
- FR-4.5: If review agent requests changes, the original agent
  is re-triggered to address them. Maximum 2 iterations
  (implement → review → revise → final review). If still failing
  after one revision, escalate to human with full context.

### FR-5: Task Status Tracking

The system MUST track task lifecycle.

- FR-5.1: Task states: pending → queued → running → pr-created →
  review → merged | failed | cancelled.
- FR-5.2: Each state transition recorded with timestamp in
  PostgreSQL.
- FR-5.3: Status queryable via MCP tool (`task_status`) and UI.
- FR-5.4: Failed tasks include failure reason and agent logs.
- FR-5.5: Tasks can be cancelled (kills running agent if active).

### FR-6: Task Configuration

The system MUST support configurable agent behavior per task type.

- FR-6.1: Task types defined in a config file (e.g., `runbook`,
  `implementation`, `spec-review`, `gap-fill`).
- FR-6.2: Each type specifies: agent prompt template, target repo,
  timeout, review required (boolean).
- FR-6.3: Default type for UI-created tasks: `general`.
- FR-6.4: Platform engineers manage config via the context repo
  (version-controlled, PRs to change).

## Non-Functional Requirements

### NFR-1: Performance

- Agent starts within 2 minutes of task creation.
- PR created within the agent's timeout window.
- Status updates propagate to UI within 10 seconds.

### NFR-2: Reliability

- Agent crash does not leave the task in a stuck state (timeout
  handler transitions to `failed`).
- Duplicate task detection prevents wasted compute.
- Agent persists memory of what it did (for restart/retry).

### NFR-3: Security

- Agents authenticate via GitHub App (org-level install) with
  short-lived installation tokens. Scoped to configured repos only.
- Agent-generated PRs require human approval for merge.
- Agent prompts are version-controlled (not editable via UI).
- No credentials in task descriptions or agent memory.

## Clarifications

### Session 2026-03-29

- Q: How does the system detect new tasks from the UI? → A: Polling loop in MCP server (every 10s). Infra-agnostic — no LISTEN/NOTIFY or K8s-specific mechanisms. System should be packageable as a product.
- Q: Which repo does an agent commit to? → A: Lore is one instance per org, manages multiple repos. Task must specify a target repo. Default for context tasks (runbooks, ADRs) is the Lore context repo. For code tasks, the repo is required — either from task type config, the task description, or the team's configured repo.
- Q: How many review iterations before escalating to human? → A: Max 2 (implement → review → revise → final review). Escalate to human if still failing after one revision.
- Q: How do agents authenticate to GitHub? → A: GitHub App installed on the org. Short-lived installation tokens per agent run, scoped to configured repos. No PATs.
- Q: How many agents can run concurrently? → A: Max 5. Overflow queued as pending until a slot opens. Configurable.

## Scope Boundaries

### In Scope

- Task event detection (UI, PR, MCP).
- Klaus agent spawning with context bundle.
- Git branch creation + PR opening.
- Task status tracking (PostgreSQL + UI + MCP).
- Review agent pipeline (configurable).
- Task type configuration.

### Out of Scope

- Auto-merge without human approval.
- Agent-to-agent communication during a task (agents work
  independently).
- Multi-repo tasks (one task = one repo).
- Cost tracking per agent run.

## Dependencies

- Klaus on GKE (already deployed).
- Lore MCP server with memory tools (Feature 2).
- GitHub API access from agent containers.
- Lore Web UI (Feature 2, for status display).
- PostgreSQL for task state (existing).

## Assumptions

- Klaus can accept task submissions and spawn containers on demand
  (verified with existing `delegate_task`).
- GitHub Actions can trigger agent spawning via webhook or workflow.
- Agent containers have access to the Lore MCP server on GKE
  (same cluster, internal DNS).

## Success Criteria

1. A product owner creates a task in the UI and receives a PR
   within 30 minutes without touching a terminal.
2. A spec pushed to a branch triggers an implementation agent that
   produces working code aligned with the spec.
3. A review agent catches a convention violation that a human
   reviewer might miss.
4. Task status is visible in real-time from creation to PR merge.
5. Agent work uses Lore context — conventions, ADRs, and memory
   from previous runs — not generic LLM knowledge.
6. A failed agent run produces a clear error with enough context
   to retry or fix manually.
