# Feature Specification: Deployment Testing

| Field          | Value                                    |
|----------------|------------------------------------------|
| Feature        | Deployment Testing                       |
| Status         | Implemented                                    |
| Created        | 2026-04-04                               |
| Owner          | Platform Engineering                     |

## Problem Statement

Lore has zero test gates in CI. Builds compile TypeScript and push
images — that's it. Every bug we caught in the last 3 days (review
loop spam, stale ingestion, 409 error shape, bucket name mismatch,
GCS permissions, system prompt stacking) shipped to production before
being discovered manually.

Current state:
- **MCP server**: 3 unit tests (facts, graph, context-assembly). Not
  run in CI.
- **Agent**: zero tests
- **Web UI**: zero tests
- **CI workflows**: build + push only. No test step.
- **Post-deploy**: zero smoke tests. Manual kubectl to verify.
- **Integration**: zero. No test that verifies the full pipeline
  (task → Job → PR) works end-to-end.

## Solution

Three layers of testing, each gated in the deployment pipeline:

```
Layer 1: Unit Tests (pre-build, blocks merge)
  ├── MCP server: tool handlers, redaction, local-runner
  ├── Agent: worker routing, watcher logic, controller status parsing
  └── Web UI: API routes, auth checks

Layer 2: Integration Tests (post-build, blocks deploy)
  ├── MCP ↔ DB: context queries, memory CRUD, pipeline tasks
  ├── Controller ↔ K8s: LoreTask CR lifecycle
  └── Webhook ↔ Pipeline: issue dispatch → task creation

Layer 3: Smoke Tests (post-deploy, alerts on failure)
  ├── Health endpoints respond
  ├── MCP tools return valid responses
  ├── Create task → verify it reaches pending status
  └── Statusline cache endpoint returns data
```

### Layer 1: Unit Tests

**What to test (no DB, no K8s, no network):**

MCP Server (`mcp-server/src/__tests__/`):
- `redact.test.ts` — API keys, JWTs, private keys, connection strings redacted
- `local-runner.test.ts` — slugify, readConfig/writeConfig, readTasks/writeTasks, skipTask
- `pipeline.test.ts` — buildPrompt, task type routing
- `ingest.test.ts` — file classification, chunking logic

Agent (`agent/src/__tests__/`):
- `worker.test.ts` — task routing (onboard, feature-request, CRD), 30s grace period query, issue skip for webhook tasks
- `loretask-watcher.test.ts` — review result parsing, re-entry guard, PR skip for review tasks
- `loretask-controller.test.ts` — status parsing, review result extraction from logs, 409 handling
- `redact.test.ts` — same patterns as MCP server

Web UI (`web-ui/src/__tests__/`):
- `logs-route.test.ts` — access control (401/403/200), offset handling
- `repo-status.test.ts` — query filtering by repo

**CI integration:**
```yaml
# In each build-*.yml, before the build step:
- name: Run tests
  run: npm test
```

Tests must pass before the image is built. Failed tests block the
deploy.

### Layer 2: Integration Tests

**What to test (needs DB, may need K8s):**

Run in a GitHub Actions job with a PostgreSQL service container:

```yaml
services:
  postgres:
    image: pgvector/pgvector:pg16
    env:
      POSTGRES_DB: lore_test
      POSTGRES_USER: lore
      POSTGRES_PASSWORD: test
    ports: ["5432:5432"]
```

Tests:
- `integration/memory.test.ts` — lore_write_memory → lore_search_memory → delete
- `integration/pipeline.test.ts` — create_task → claim → complete lifecycle
- `integration/ingest.test.ts` — ingest file → lore_search_context finds it
- `integration/webhook.test.ts` — simulate GitHub webhook → task created
- `integration/repo-status.test.ts` — onboarded repo returns correct data

**CI integration:**
```yaml
# New workflow: test-integration.yml
# Triggers: on push to main, on PR
# Runs after unit tests pass
```

### Layer 3: Smoke Tests (Post-Deploy)

Run after every deployment. If any fail, alert (GitHub Issue or Slack).

```bash
#!/bin/bash
# scripts/smoke-test.sh

API_URL="${LORE_API_URL}"
TOKEN="${LORE_INGEST_TOKEN}"

echo "=== Health ==="
curl -sf "$API_URL/healthz" | jq '.status' | grep -q '"ok"' || fail "healthz"

echo "=== Repo Status ==="
curl -sf -H "Authorization: Bearer $TOKEN" \
  "$API_URL/api/repo-status?repo=re-cinq/lore" | jq '.onboarded' | grep -q 'true' || fail "repo-status"

echo "=== Create Test Task ==="
TASK=$(curl -sf -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"description":"smoke-test","task_type":"general","target_repo":"re-cinq/lore","created_by":"smoke-test"}' \
  "$API_URL/api/task")
TASK_ID=$(echo "$TASK" | jq -r '.task_id')
[ -n "$TASK_ID" ] || fail "create-task"

echo "=== Cancel Test Task ==="
# Clean up immediately
curl -sf -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"task_id\":\"$TASK_ID\",\"action\":\"cancel\"}" \
  "$API_URL/api/task" || fail "cancel-task"

echo "=== All smoke tests passed ==="
```

**CI integration:**
Add a step at the end of each build workflow (after deploy):
```yaml
- name: Smoke test
  run: bash scripts/smoke-test.sh
  env:
    LORE_API_URL: ${{ vars.LORE_API_URL }}
    LORE_INGEST_TOKEN: ${{ secrets.LORE_INGEST_TOKEN }}
```

### Test Framework

| Package | Framework | Why |
|---------|-----------|-----|
| mcp-server | Vitest (already configured) | Fast, TypeScript native |
| agent | Vitest | Same stack, consistent |
| web-ui | Vitest + @testing-library/react | Next.js compatible |
| integration | Vitest | Shared config |
| smoke | Bash + curl | No deps, runs anywhere |

### What NOT to Test

- Claude Code output quality (that's what evals/ is for)
- GitHub API behavior (mock it)
- GCS actual writes in unit tests (mock @google-cloud/storage)
- K8s actual CRD operations in unit tests (mock k8s client)
- LLM responses (mock Anthropic API)

### Priority Order

1. **Smoke tests in CI** — highest value, catches deploy breakage.
   Add `scripts/smoke-test.sh` + CI step. Half a day.
2. **Unit tests for critical paths** — redaction, task routing,
   watcher re-entry, 409 handling. The bugs we actually hit. One day.
3. **Integration tests** — memory + pipeline lifecycle. Catches
   schema mismatches (like `is_deleted` vs `deleted_at`). One day.
4. **Web UI tests** — access control on logs route. Lower priority
   since the UI is less critical than the pipeline.

## File Changes

| File | Change |
|------|--------|
| `scripts/smoke-test.sh` | New: post-deploy smoke tests |
| `.github/workflows/build-agent.yml` | Add: test + smoke steps |
| `.github/workflows/build-mcp.yml` | Add: test + smoke steps |
| `.github/workflows/build-ui.yml` | Add: test step |
| `.github/workflows/test-integration.yml` | New: integration test workflow |
| `mcp-server/src/__tests__/redact.test.ts` | New: redaction unit tests |
| `mcp-server/src/__tests__/local-runner.test.ts` | New: local runner unit tests |
| `agent/src/__tests__/worker.test.ts` | New: task routing tests |
| `agent/src/__tests__/loretask-watcher.test.ts` | New: watcher logic tests |
| `agent/vitest.config.ts` | New: vitest config |
| `agent/package.json` | Add: vitest dev dep + test script |

## Acceptance Criteria

1. CI blocks merge if unit tests fail
2. CI blocks deploy if integration tests fail
3. Smoke tests run after every deploy
4. Smoke test failure creates a GitHub Issue
5. Redaction patterns have 100% coverage ([validated by `redact.test.ts`](libs/shared/src/redact.test.ts))

6. Task routing logic has tests for every task type — onboard→`handleOnboard`,
   feature-request→`handleFeatureRequest`, and implementation/review/general/runbook/gap-fill/unknown
   →`handleClaudeCodeTask`. ([validated by `worker.test.ts:63`](apps/floor/src/jobs/task/worker.test.ts#L63), [`worker.test.ts:64`](apps/floor/src/jobs/task/worker.test.ts#L64), [`worker.test.ts:68`](apps/floor/src/jobs/task/worker.test.ts#L68), [`worker.test.ts:72`](apps/floor/src/jobs/task/worker.test.ts#L72), [`worker.test.ts:76`](apps/floor/src/jobs/task/worker.test.ts#L76), [`worker.test.ts:80`](apps/floor/src/jobs/task/worker.test.ts#L80), [`worker.test.ts:84`](apps/floor/src/jobs/task/worker.test.ts#L84), [`worker.test.ts:88`](apps/floor/src/jobs/task/worker.test.ts#L88), [`worker.test.ts:92`](apps/floor/src/jobs/task/worker.test.ts#L92))

6a. Worker pure helpers are unit-tested: `slugify` lowercases, strips special chars, collapses runs to
   a single hyphen, trims leading/trailing hyphens, and truncates to 30 chars; `buildPrompt` fills the
   `{description}` placeholder and falls back matching-type → general → hardcoded default; `issueRef`
   emits `Refs #N` for a number and empty for null. ([validated by `worker.test.ts:7`](apps/floor/src/jobs/task/worker.test.ts#L7), [`worker.test.ts:13`](apps/floor/src/jobs/task/worker.test.ts#L13), [`worker.test.ts:17`](apps/floor/src/jobs/task/worker.test.ts#L17), [`worker.test.ts:21`](apps/floor/src/jobs/task/worker.test.ts#L21), [`worker.test.ts:28`](apps/floor/src/jobs/task/worker.test.ts#L28), [`worker.test.ts:32`](apps/floor/src/jobs/task/worker.test.ts#L32), [`worker.test.ts:36`](apps/floor/src/jobs/task/worker.test.ts#L36), [`worker.test.ts:113`](apps/floor/src/jobs/task/worker.test.ts#L113), [`worker.test.ts:123`](apps/floor/src/jobs/task/worker.test.ts#L123), [`worker.test.ts:133`](apps/floor/src/jobs/task/worker.test.ts#L133), [`worker.test.ts:141`](apps/floor/src/jobs/task/worker.test.ts#L141), [`worker.test.ts:159`](apps/floor/src/jobs/task/worker.test.ts#L159), [`worker.test.ts:163`](apps/floor/src/jobs/task/worker.test.ts#L163))

7. Watcher re-entry guard has a test
8. 409 CR handling has a test — `isAlreadyExistsError` returns true for a Kubernetes
   AlreadyExists conflict in every shape it arrives (a 409 in `code`, `statusCode`, or
   `response.statusCode`; `body.reason` = AlreadyExists; `body.code` = 409; the client's
   `HTTP-Code: 409` message dump; an `already exists` message; or a `reason=AlreadyExists`
   message) and false for anything else (a 500, a different-reason body, an object with no
   recognizable fields, null, or a string). ([validated by `k8s-errors.test.ts:5`](libs/shared/src/k8s-errors.test.ts#L5), [`k8s-errors.test.ts:9`](libs/shared/src/k8s-errors.test.ts#L9), [`k8s-errors.test.ts:13`](libs/shared/src/k8s-errors.test.ts#L13), [`k8s-errors.test.ts:17`](libs/shared/src/k8s-errors.test.ts#L17), [`k8s-errors.test.ts:23`](libs/shared/src/k8s-errors.test.ts#L23), [`k8s-errors.test.ts:27`](libs/shared/src/k8s-errors.test.ts#L27), [`k8s-errors.test.ts:36`](libs/shared/src/k8s-errors.test.ts#L36), [`k8s-errors.test.ts:42`](libs/shared/src/k8s-errors.test.ts#L42), [`k8s-errors.test.ts:48`](libs/shared/src/k8s-errors.test.ts#L48), [`k8s-errors.test.ts:54`](libs/shared/src/k8s-errors.test.ts#L54), [`k8s-errors.test.ts:63`](libs/shared/src/k8s-errors.test.ts#L63), [`k8s-errors.test.ts:67`](libs/shared/src/k8s-errors.test.ts#L67), [`k8s-errors.test.ts:71`](libs/shared/src/k8s-errors.test.ts#L71))
