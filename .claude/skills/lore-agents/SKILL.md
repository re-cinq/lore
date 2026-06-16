---
name: lore-agents
description: View and edit this repo's Lore agent definitions (model, timeout, prompt, image) — list resolved definitions and create/update/delete per-repo overrides via the Lore agent-definitions API.
---

You are helping a developer manage the **agent definitions** for the repo they're
in. An *agent definition* is the per-task-type config (model, timeout, prompt,
image) an Agent runs from — config, not a run (ADR-024). Each repo inherits
organisation defaults (`project_id = NULL`) and may override any definition with
its own row. All access goes through the Lore agent-definitions API
(`/api/repos/:owner/:repo/agent-definitions`) — never the database directly.

## Prerequisites

- Confirm `pwd` is inside the target repo; derive `owner/repo` from the git remote.
- Need `LORE_API_URL` and a token. Reads use a read-scoped token; writes need an
  **admin**-scoped token (`LORE_ADMIN_TOKEN` or `LORE_INGEST_TOKEN`). Bail with a
  clear message if neither is set.

## Operations

**List** the repo's resolved agent definitions (org defaults overlaid with repo overrides):
```
curl -fsS -H "authorization: Bearer $LORE_API_URL_TOKEN" \
  "$LORE_API_URL/api/repos/<owner>/<repo>/agent-definitions"
```
Each entry has `name, model, timeout_minutes, prompt, image, execution_mode,
review_required, project_id`. `project_id: null` means the value is inherited
(no repo override yet).

**Resolve one** agent (what a runner would fetch):
```
curl -fsS -H "authorization: Bearer $TOKEN" \
  "$LORE_API_URL/api/repos/<owner>/<repo>/agent-definitions/<name>"
```

**Create** a new repo agent (admin token):
```
curl -fsS -X POST -H "authorization: Bearer $ADMIN_TOKEN" -H "content-type: application/json" \
  "$LORE_API_URL/api/repos/<owner>/<repo>/agent-definitions" \
  -d '{"name":"my-agent","model":"claude-opus-4-8","timeout_minutes":45,"prompt":"Do {description}"}'
```

**Update / override** an agent (upserts the repo's row; admin token):
```
curl -fsS -X PUT -H "authorization: Bearer $ADMIN_TOKEN" -H "content-type: application/json" \
  "$LORE_API_URL/api/repos/<owner>/<repo>/agent-definitions/<name>" \
  -d '{"model":"claude-haiku-4-5-20251001"}'
```

**Delete** the repo override (reverts to the org default; admin token):
```
curl -fsS -X DELETE -H "authorization: Bearer $ADMIN_TOKEN" \
  "$LORE_API_URL/api/repos/<owner>/<repo>/agent-definitions/<name>"
```

## Rules

- `model` accepts the curated ids (`claude-opus-4-8`, `claude-sonnet-4-6`,
  `claude-haiku-4-5-20251001`, `claude-fable-5`) or any custom model id.
- A null/absent field **inherits** the next layer (org default → task-types.yaml).
  To clear an override, DELETE the row rather than sending nulls.
- **`image` is two-key gated.** Setting a non-empty execution image returns
  `403 two_key_required` unless you pass an `x-lore-approval-pr: owner/repo#N`
  header referencing an open PR labeled `dark-factory-approval` approved by a
  CODEOWNER of the repo's `CLAUDE.md`. Surface this to the developer; do not try
  to bypass it.
- Always show the developer the before/after of a change. Confirm destructive
  ops (delete) before running them.
