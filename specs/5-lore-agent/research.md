# Research: Lore Agent Service

## Decision 1: Anthropic SDK vs Raw HTTP

**Decision:** Use `@anthropic-ai/sdk` (official TypeScript SDK)

**Rationale:** Typed responses, automatic retry with backoff, streaming
support, token counting in response metadata. Eliminates manual HTTP
error handling and auth header management.

**Alternatives considered:**
- Raw `fetch` to `api.anthropic.com` — simpler but no retry, no types,
  manual token extraction
- LangChain — too heavy for prompt-in/text-out; we don't need chains,
  agents, or memory abstractions

## Decision 2: Scheduler Library

**Decision:** Simple `setInterval` + cron expression parser (`cron-parser` npm package)

**Rationale:** The service runs 5 jobs with fixed schedules. No need for
a full job queue (Bull, Agenda) or distributed scheduler. `cron-parser`
parses cron expressions to determine next run time; `setInterval` checks
every 30 seconds if any job is due. Missed runs (service was down) are
detected by comparing last run timestamp in DB against schedule.

**Alternatives considered:**
- `node-cron` — popular but no missed-run detection, no DB persistence
- `bullmq` + Redis — overkill for 5 jobs on a single replica; adds Redis dependency
- K8s CronJobs — what we're replacing; no observability, no missed-run recovery

## Decision 3: Output Parsing Strategy

**Decision:** Instruct the LLM to respond with JSON only (system prompt),
then parse with `JSON.parse`. On failure, extract via brace-matching.
On second failure, fall through to single-file PR.

**Rationale:** Direct API control means we set the system prompt to
enforce JSON output. No more `result_text` wrapping or code fences
from Klaus. The fallback chain handles edge cases without losing work.

**Alternatives considered:**
- Anthropic's tool_use for structured output — viable but adds
  complexity; simple JSON instruction works well with Haiku
- XML output — harder to parse, no advantage over JSON

## Decision 4: Task Processing Model

**Decision:** Sequential processing (one task at a time), configurable
via `MAX_CONCURRENT` env var (default 1).

**Rationale:** Haiku is fast (~30s for onboarding). Sequential
processing simplifies error handling, prevents cost spikes, and avoids
GitHub API rate limits. Can increase to 2-3 later if backlog grows.

**Alternatives considered:**
- Parallel processing (3-5 concurrent) — premature; current volume is
  <10 tasks/day
- Worker pool with queue — overkill for single replica

## Decision 5: Crash Recovery Implementation

**Decision:** On startup, query `pipeline.tasks WHERE status IN
('running', 'queued') AND updated_at < now() - timeout_interval`,
reset to 'pending'.

**Rationale:** Simple, reliable, no external state. The task timeout
is already in task-types.yaml per task type. Checking `updated_at`
ensures we don't reset tasks that another instance just picked up
(though we run single-replica).

**Alternatives considered:**
- Advisory locks — unnecessary for single replica
- Heartbeat column — adds complexity without benefit at current scale

## Decision 6: Reusing Existing Modules vs Rewrite

**Decision:** Copy and adapt `pipeline-github.ts` and `repo-onboard.ts`
(fetchRepoContext) from the MCP server. Rewrite `pipeline.ts` (task
processing) and `klaus-client.ts` (replace entirely with anthropic.ts).

**Rationale:** GitHub App auth and repo context fetching are well-tested
and identical in both services. Task processing logic needs fundamental
changes (direct API vs MCP protocol). Clean break from Klaus.

**Modules to copy:**
- `pipeline-github.ts` → `agent/src/github.ts` (branch, commit, PR)
- `repo-onboard.ts` (fetchRepoContext only) → `agent/src/repo-context.ts`
- `pipeline-config.ts` → `agent/src/config.ts` (task-types.yaml loader)

**Modules to rewrite:**
- `klaus-client.ts` → `agent/src/anthropic.ts` (direct API)
- `pipeline.ts` → `agent/src/worker.ts` (sequential processor)
- New: `agent/src/scheduler.ts` (cron jobs)
- New: `agent/src/health.ts` (HTTP health endpoint)

## Decision 7: LLM Call Logging

**Decision:** New `pipeline.llm_calls` table in PostgreSQL.

**Rationale:** Queryable cost tracking without parsing logs. The web UI
can show cost-per-task and daily totals. Simpler than pushing to Cloud
Monitoring for this use case.

**Schema:**
- id UUID PK
- task_id UUID nullable FK → pipeline.tasks
- job_name TEXT nullable
- model TEXT
- input_tokens INT
- output_tokens INT
- cost_usd NUMERIC(10,6)
- duration_ms INT
- created_at TIMESTAMPTZ
