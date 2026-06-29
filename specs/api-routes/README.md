# HTTP API Routes — spec index

One reconstruction-grade spec per mcp-server HTTP route (the `/api/*` + `/healthz`
endpoints registered in `mcp-server/src/api/routes/index.ts`). Each spec documents
the method, path, auth scope, request/response contract, and behavior, linked to
its handler source (`IMPLEMENTED_BY`) and route tests (`VALIDATED_BY`).

These are the server's **HTTP request surface** — distinct from the MCP **tools**
([specs/mcp-tools/](../mcp-tools/README.md)). Some tools proxy to these routes;
that's plumbing, not duplication.

> **Auth** is a bearer token whose scope must cover the route (`read` < `write` <
> `task` / `webhook` / `admin`; the legacy `LORE_INGEST_TOKEN` and `admin` satisfy
> everything). Centralized in `mcp-server/src/api/routes/auth.ts`
> (`ROUTE_SCOPES` prefix map + `SCOPE_OVERRIDES` regex table; unmatched → `read`).
> Webhooks use HMAC signatures instead of scopes; `/healthz` is unauthenticated.

## Context & ingestion
| Route | Spec | Auth | Purpose |
|-------|------|------|---------|
| `POST /api/ingest` | [spec](ingest/spec.md) | write | Embed changed files into pgvector; fan out graph re-projection. |
| `POST /api/onboard` | [spec](onboard/spec.md) | admin | Onboard a repo (opens a PR). |
| `GET /api/context` | [spec](context/spec.md) | read | Assemble context (the engine behind `lore_assemble_context`). |
| `GET /api/repo-status` | [spec](repo-status/spec.md) | read | Repo freshness / last-ingest / stale flag. |

## Tasks
| Route | Spec | Auth | Purpose |
|-------|------|------|---------|
| `POST /api/task` | [spec](task-post/spec.md) | task | Create / retry / cancel / set-priority / status-update. |
| `GET /api/tasks/:id/timeline` | [spec](task-timeline/spec.md) | read | Stage-commit timeline for a task. |
| `GET /api/tasks/by-pr/:o/:r/:n` | [spec](task-by-pr/spec.md) | read | Resolve a PR → its task (DB → PR-body → trailer). |
| `POST /api/task-logs` | [spec](task-logs/spec.md) | write | Upload a task's logs to GCS. |

## Memory
| Route | Spec | Auth | Purpose |
|-------|------|------|---------|
| `POST /api/memory` | [spec](memory/spec.md) | write | Memory tool actions over HTTP (action dispatch). |
| `POST /api/episode` | [spec](episode/spec.md) | write | Ingest an episode; trigger fact/graph extraction. |
| `POST /api/session-summary` | [spec](session-summary/spec.md) | write | Stop-hook session dump → episode + extraction. |

## Webhooks (HMAC-authenticated)
| Route | Spec | Auth | Purpose |
|-------|------|------|---------|
| `POST /api/webhook/github` | [spec](webhook-github/spec.md) | HMAC `sha256=` | PR/review/comment/issue events → review-reactor / auto-merge / task. |
| `POST /api/webhook/slack` | [spec](webhook-slack/spec.md) | HMAC `v0=` | `/lore` slash command → create/retry tasks. |
| `POST /api/webhook/incident` | [spec](webhook-incident/spec.md) | path-exempt, repo-gated | PagerDuty/Opsgenie → `settings.incidents`. |

## Spec-traceability
| Route | Spec | Auth | Purpose |
|-------|------|------|---------|
| ~~`POST /api/repos/:o/:r/coverage`~~ | [spec](repo-coverage/spec.md) | — | **Removed** (cutover): coverage is parsed in the lore-code-trace binary now; ingest is the Floor `ci-tests` hook. |
| ~~`POST /api/repos/:o/:r/test-report`~~ | [spec](repo-test-report/spec.md) | — | **Removed** (cutover): test ingest is `POST /api/webhook/ci-tests` on Floor, fed by the lore-code-trace binary. |
| `POST /api/repos/:o/:r/impact` | [spec](repo-impact/spec.md) | write | Deterministic pre-merge spec-impact for a diff. |
| `GET /api/repos/:o/:r/trace/*` | [spec](repo-trace/spec.md) | read | Read a repo's trace docs/graph/ring. |
| `GET /api/trace/specs` | [spec](global-trace-specs/spec.md) | read | Cross-repo spec document list. |

## Admin & health
| Route | Spec | Auth | Purpose |
|-------|------|------|---------|
| `GET /healthz` | [spec](healthz/spec.md) | none | Liveness probe. |
| `/api/tokens` | [spec](tokens/spec.md) | admin | API token create / list / revoke. |
| `/api/repos/:o/:r/settings/dark-factory` | [spec](dark-factory-settings/spec.md) | admin + two-key | Dark-factory settings (privileged-field approval ceremony). |
