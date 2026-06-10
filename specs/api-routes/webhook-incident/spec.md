# Feature Specification: POST /api/webhook/incident

| Field   | Value                                                              |
|---------|-------------------------------------------------------------------|
| Feature | Incident webhook receiver (PagerDuty / Opsgenie)                  |
| Status  | **Draft**                                                        |
| Created | 2026-06-10                                                       |
| Owner   | Platform Engineering                                            |
| Route   | `POST /api/webhook/incident`                                     |
| Auth    | None at the handler (router-level `webhook` rate-limit bucket; auth-exempt path — the deployment fronts it with a provider-shared secret URL) |
| Module  | `mcp-server/src/api/routes/webhooks.ts` (`handleIncidentWebhook`) |

## Problem Statement

`assemble_context` surfaces recent production incidents at priority 1 so agents
know a service is on fire before they touch it. Incident sources (PagerDuty,
Opsgenie, or a direct caller) POST an incident here; the endpoint normalizes the
payload and upserts it into `lore.repos.settings.incidents`, keeping the 10 most
recent FIFO. The route sits under the `/api/webhook/*` prefix, so the router
exempts it from bearer-scope auth and rate-limits it in the `webhook` bucket;
unlike the GitHub and Slack receivers it carries **no HMAC verification at the
handler** — the body shape is the only gate (`repo` must resolve).

## Interface

Registered in the route table ([registration](../../../mcp-server/src/api/routes/index.ts#L69)).

- **Method + path**: `POST /api/webhook/incident`
- **Auth**: none at the handler. The router exempts `/api/webhook/*` from
  bearer-scope auth ([auth exemption](../../../mcp-server/src/api/routes/index.ts#L100))
  and applies the `webhook` rate-limit bucket. There is no signature check —
  the only required field is a resolvable repo.
- **Request body** (JSON) — either a direct entry or a provider envelope:
  - Direct: `{repo, title?, severity?, date?, resolved?, url?}`.
  - Envelope: `{incident: {repo? | service.name?, title? | summary?, severity? | urgency?, date?, resolved? | status?, url? | html_url?}}`.
- **Response**: `200 {ok:true, repo}` on upsert; `400` no resolvable repo;
  `500` parse/DB error; `503` pool unavailable.

## Behavior

1. **Pool gate** — null pool → `503 {error:"database not available"}`.
2. **Parse** the raw body as JSON (parse failure is caught → `500`).
3. **Unwrap** the envelope: `incident = payload.incident || payload`.
4. **Resolve repo** — `incident.repo || incident.service?.name`; absent →
   `400 {error:"required: repo (or incident.repo)"}`.
5. **Normalize entry**:
   - `title` ← `incident.title || incident.summary || "Unknown incident"`.
   - `severity` ← `incident.severity || incident.urgency || "unknown"`.
   - `date` ← `incident.date || new Date().toISOString()`.
   - `resolved` ← `incident.resolved || incident.status === "resolved" || false`.
   - `url` ← `incident.url || incident.html_url || null`.
6. **Upsert (FIFO ≤ 10)** — `UPDATE lore.repos SET settings = jsonb_set(...,
   '{incidents}', …)` appending the new entry, `ORDER BY date DESC LIMIT 10`,
   scoped `WHERE full_name = repo`. Then `200 {ok:true, repo}`.
7. Any thrown error in the try block → `500 {error: message}`.

**Env vars**: none (DB pool only).

## Output

| Branch | Status | Body |
|--------|--------|------|
| Pool null | 503 | `{"error":"database not available"}` |
| No repo resolvable | 400 | `{"error":"required: repo (or incident.repo)"}` |
| Upsert ok | 200 | `{"ok":true,"repo":"{full_name}"}` |
| Parse/DB error | 500 | `{"error":"{message}"}` |

## Dependencies & side effects

- DB: `UPDATE lore.repos.settings.incidents` (the only side effect; FIFO ≤ 10).
- No external calls, no signature helper, no agent fan-out.

## Acceptance Criteria

A null pool returns 503 and an unresolvable repo returns 400. ([validated by `returns 503 when pool is null`](../../../mcp-server/src/api/routes/webhook-incident.test.ts#L20), [`returns 400 when no repo can be resolved`](../../../mcp-server/src/api/routes/webhook-incident.test.ts#L24))

A direct-format incident upserts and returns `{ok:true, repo}`. ([validated by `upserts a direct-format incident`](../../../mcp-server/src/api/routes/webhook-incident.test.ts#L28))

A PagerDuty/Opsgenie envelope resolves repo from `incident.service.name` and maps `summary`/`urgency`/`status`/`html_url` onto the entry. ([validated by `maps a PagerDuty/Opsgenie envelope`](../../../mcp-server/src/api/routes/webhook-incident.test.ts#L34))

`status:"resolved"` derives `resolved:true` and the upsert SQL caps the list at 10 (FIFO). ([validated by `derives resolved=true from status resolved and writes a FIFO-capped entry`](../../../mcp-server/src/api/routes/webhook-incident.test.ts#L53))

Missing `title`/`severity` default to `"Unknown incident"`/`"unknown"` with `resolved:false`. ([validated by `defaults title and severity when neither incident field is present`](../../../mcp-server/src/api/routes/webhook-incident.test.ts#L62))

A DB failure and a malformed JSON body both return 500. ([validated by `returns 500 when the upsert throws`](../../../mcp-server/src/api/routes/webhook-incident.test.ts#L43), [`returns 500 on a malformed JSON body`](../../../mcp-server/src/api/routes/webhook-incident.test.ts#L49))

## Out of Scope

- Provider webhook configuration (PagerDuty/Opsgenie subscription setup).
- How `assemble_context` reads and ranks `settings.incidents`.
- Any signature/auth enforcement (the handler has none — gated only by the
  shared-secret URL the deployment exposes and the `webhook` rate-limit bucket).
