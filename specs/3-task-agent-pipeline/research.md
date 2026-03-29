# Research: Task-to-Agent Pipeline

## R1: Task Polling -- MCP Server Internal Polling Loop

**Decision:** Detect new tasks via a `setInterval` loop in the MCP
server process, querying `pipeline.tasks WHERE status = 'pending'`
every 10 seconds.

**Rationale:** The spec requires infra-agnostic event detection --
the system must be packageable and deployable anywhere, not tied to
PostgreSQL LISTEN/NOTIFY or Kubernetes-specific event mechanisms. A
polling loop is the simplest approach that works on any PostgreSQL
installation, any hosting environment, and any container runtime.
The 10-second interval meets the NFR-1 requirement (agent starts
within 2 minutes of task creation) with significant margin.

**Alternatives considered:**
- PostgreSQL LISTEN/NOTIFY: instant delivery but requires a
  persistent connection dedicated to notifications. Not supported by
  all PostgreSQL-compatible databases (e.g., CockroachDB, some
  managed offerings). Violates the infra-agnostic requirement.
- Kubernetes watch on a CRD: ties the system to Kubernetes. Cannot
  be packaged as a standalone binary or run on a VM. The spec
  explicitly calls out portability.
- Message queue (NATS, Redis Streams): adds a new infrastructure
  dependency for a single use case. The polling volume (1 query per
  10 seconds) does not justify a message broker.
- GitHub webhook to trigger agent: only covers PR-based events, not
  UI-created tasks or MCP-created tasks. Would need polling anyway
  for the other sources.

**Performance note:** One `SELECT ... WHERE status = 'pending'
ORDER BY created_at ASC LIMIT 1 FOR UPDATE SKIP LOCKED` query every
10 seconds is negligible load. The `status` index makes it a single
index scan. At 100,000 total tasks, the query returns in <1ms.

## R2: GitHub App Auth -- octokit + @octokit/auth-app

**Decision:** Authenticate to GitHub via a GitHub App installed on
the org. Use `@octokit/auth-app` to generate short-lived
installation tokens scoped to configured repositories. No personal
access tokens.

**Rationale:** GitHub Apps are the recommended authentication
mechanism for automated systems. Installation tokens expire after 1
hour, limiting blast radius. Tokens are scoped to specific
repositories via the App's installation configuration. The
`@octokit/auth-app` library handles JWT signing and token caching
transparently. This aligns with constitution Principle 2 (Zero
Stored Credentials) -- the App private key is the only long-lived
secret, and it is injected via K8s Secret with Workload Identity.

**Alternatives considered:**
- Personal Access Tokens (PATs): long-lived, not scoped to specific
  repos, tied to a user account. Violates P2 (Zero Stored
  Credentials). If the token leaks, all repos the user has access to
  are compromised.
- GitHub Actions OIDC tokens: only available inside GitHub Actions
  workflows. Cannot be used from GKE pods. Would require routing all
  agent work through GitHub Actions, which defeats the purpose of
  running agents on our own cluster.
- OAuth App: requires user interaction for token generation. Not
  suitable for automated headless agents.
- Fine-grained PATs: better scoping than classic PATs but still
  long-lived and tied to a user. Token rotation is manual.

**Setup requirements:**
1. Create a GitHub App in the `re-cinq` org.
2. Grant permissions: `contents: write`, `pull_requests: write`,
   `issues: read`.
3. Install the App on the org (or specific repos).
4. Store the App private key as a K8s Secret.
5. Inject `GITHUB_APP_ID` and `GITHUB_APP_PRIVATE_KEY` as env vars
   on the MCP server pods.

## R3: Task Type Config -- YAML File in Context Repo

**Decision:** Define task types in a YAML file
(`scripts/task-types.yaml`) committed to the Lore context repo.
Loaded once on MCP server startup. Supports hot-reload via SIGHUP.

**Rationale:** Version-controlled configuration aligns with
constitution Principle 6 (Distributed Ownership with CI Eval Gates)
and spec FR-6.4 (platform engineers manage config via the context
repo). YAML is human-readable and diff-friendly. Changes to task
types go through PR review like any other config change.

**Alternatives considered:**
- Database table: editable via UI, but loses version control and PR
  review workflow. Changes are invisible in git history. Harder to
  roll back.
- Environment variables: works for simple flags but not for
  structured data (prompt templates, per-type timeouts). Would need
  one env var per field per type -- unmanageable at scale.
- JSON file: functionally equivalent to YAML but less readable for
  multi-line prompt templates. YAML's block scalar syntax (`|`) is
  better suited for embedded prompts.
- Admin UI: requires building a config editor, access control, and
  audit trail. Significant scope for a feature that changes
  infrequently. The context repo already provides all of this.

**Schema:**
```yaml
task_types:
  <type_name>:
    prompt_template: string   # Required. Prompt prefix for the agent.
    target_repo: string       # Optional. Default target repo for this type.
    timeout_minutes: number   # Required. Agent timeout.
    review_required: boolean  # Required. Whether to trigger review agent.
```

## R4: Agent Spawning -- Extend Existing Klaus Client

**Decision:** Extend the existing `klaus-client.ts` with a new
function that submits tasks with pipeline-specific context (task
type prompt, context bundle, GitHub token, branch naming convention).

**Rationale:** Klaus already accepts task submissions via its HTTP
endpoint at `/mcp`. The existing `submitTask()` function handles
connection management, error handling, and response parsing. Adding
pipeline-specific context to the submission payload is a minimal
change that reuses proven infrastructure. No new HTTP client or
transport layer needed.

**Alternatives considered:**
- New dedicated pipeline client: duplicates HTTP connection
  management and error handling from `klaus-client.ts`. Two clients
  to maintain for the same Klaus endpoint.
- Direct Kubernetes API (create Job/Pod): bypasses Klaus entirely.
  Loses Klaus's task management, logging, and status tracking.
  Requires the MCP server to have K8s RBAC for pod creation --
  broader permissions than needed.
- gRPC to Klaus: would require Klaus to expose a gRPC endpoint in
  addition to HTTP. The pipeline does not need streaming or
  bidirectional communication -- HTTP request/response is sufficient.

**Extension to `klaus-client.ts`:**
```typescript
export interface PipelineTaskRequest extends SubmitTaskRequest {
  target_repo: string;
  branch_name: string;
  github_token: string;
  timeout_minutes: number;
  task_id: string;  // Pipeline task UUID for tracking
}
```

## R5: PR Creation -- Octokit REST API

**Decision:** Create branches, commits, and pull requests via the
GitHub REST API using the `octokit` library authenticated with
installation tokens from the GitHub App.

**Rationale:** The GitHub REST API provides all required operations
(create ref, create tree, create commit, create pull request, add
labels) and is well-documented with TypeScript types. The `octokit`
library is the official GitHub SDK for JavaScript/TypeScript, handles
rate limiting and retries, and integrates directly with
`@octokit/auth-app` for authentication.

**Alternatives considered:**
- Git CLI from the agent container: requires `git` to be installed
  in Klaus containers, SSH key management or credential helper setup,
  and shell command orchestration. More failure modes than REST API
  calls.
- GitHub GraphQL API: more efficient for complex queries but more
  verbose for simple CRUD operations like creating a branch or PR.
  The REST API is simpler for the operations the pipeline needs.
- `simple-git` library: a Node.js wrapper around the git CLI. Same
  drawbacks as raw git CLI (requires git binary, credential
  management) with an additional dependency.

**Operations used:**
1. `GET /repos/{owner}/{repo}/git/ref/heads/{base}` -- get base
   branch SHA.
2. `POST /repos/{owner}/{repo}/git/refs` -- create branch ref.
3. `POST /repos/{owner}/{repo}/git/trees` -- create tree with
   file changes.
4. `POST /repos/{owner}/{repo}/git/commits` -- create commit.
5. `PATCH /repos/{owner}/{repo}/git/refs/heads/{branch}` -- update
   branch to new commit.
6. `POST /repos/{owner}/{repo}/pulls` -- create pull request.
7. `POST /repos/{owner}/{repo}/issues/{number}/labels` -- add
   `agent-generated` label.

## R6: Review Agent -- Same Klaus Spawning, Different Prompt

**Decision:** The review agent is a regular Klaus agent spawned
through the same pipeline infrastructure, but with a review-specific
prompt template that instructs it to review the PR rather than
implement code.

**Rationale:** Reusing the same spawning mechanism means no new
infrastructure for reviews. The review agent has the same
capabilities as the implementation agent -- it can search Lore
context, read ADRs, and access GitHub. The only difference is the
prompt. This aligns with Principle 9 (Intelligent Agents Over
Mechanical Scripts) -- the review agent reasons about code quality
using organizational context, not just lint rules.

**Alternatives considered:**
- Dedicated review service: a separate microservice that runs
  review logic. Adds a new deployment, new monitoring, and a new
  codebase to maintain. The review logic is not complex enough to
  justify a separate service.
- GitHub Actions workflow for reviews: runs on GitHub's
  infrastructure, not our GKE cluster. Cannot access Lore MCP for
  context retrieval. Limited to what Actions can do (no persistent
  state, no Lore memory).
- External code review tool (CodeRabbit, Codacy): does not have
  access to Lore context (ADRs, conventions, specs). Reviews would
  be generic rather than organization-aware. Adds an external
  dependency and cost.

**Review prompt template:**
```
Review this pull request against the following criteria:
1. Does the implementation match the original task description?
2. Does it follow the team's conventions from Lore context?
3. Does it align with relevant ADRs?
4. Are there any security, performance, or correctness issues?

Post specific, actionable comments on the PR. If the implementation
is acceptable, approve the review. If changes are needed, request
changes with clear explanations.

Original task: {task_description}
PR diff: {pr_diff}
Relevant context: {lore_context}
```

## R7: Concurrency Control -- In-Memory Counter + DB Query

**Decision:** Enforce the maximum concurrent agent limit (default 5)
by counting running tasks in the database at each poll cycle:
`SELECT count(*) FROM pipeline.tasks WHERE status IN ('running',
'queued')`.

**Rationale:** The database is the single source of truth for task
state. Counting running tasks from the database is atomic, correct
across multiple poller instances, and requires no additional
infrastructure. The query is fast (index scan on `status` column)
and runs at most once per 10-second poll cycle.

**Alternatives considered:**
- In-memory counter only: breaks when multiple MCP server instances
  run (each has its own counter). Also breaks on restart (counter
  resets to zero while tasks are still running on Klaus). Not
  suitable for production.
- Redis semaphore: adds a Redis dependency for a single counter.
  Redis is not in the existing stack. The database query is equally
  fast and does not require new infrastructure.
- Kubernetes resource quota: limits pods, not logical tasks. A task
  might not correspond to exactly one pod (Klaus might batch). Also
  ties the system to Kubernetes.
- Distributed lock (etcd, ZooKeeper): extreme overkill for counting
  to 5. Adds significant operational complexity for a trivial
  operation.

**Implementation:**
```typescript
async function canSpawnAgent(pool: pg.Pool): Promise<boolean> {
  const maxAgents = parseInt(process.env.LORE_MAX_AGENTS || '5', 10);
  const { rows } = await pool.query(
    `SELECT count(*)::int AS running
     FROM pipeline.tasks
     WHERE status IN ('running', 'queued')`
  );
  return rows[0].running < maxAgents;
}
```
