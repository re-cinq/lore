# Feature Specification: /api/repos/:owner/:repo/settings/dark-factory API Route

| Field       | Value                                                                       |
|-------------|-----------------------------------------------------------------------------|
| Feature     | Dark-Factory Settings API Route                                             |
| Status      | **Implemented**                                                             |
| Created     | 2026-06-10                                                                  |
| Owner       | Platform Engineering                                                        |
| Route       | `GET / PUT /api/repos/:owner/:repo/settings/dark-factory`                   |
| Auth scope  | **admin** + two-key CODEOWNERS-approval-PR ceremony on privileged fields   |
| Module      | `mcp-server/src/api/routes/dark-factory.ts` (`handleDarkFactorySettingsRoute`) |

## Problem Statement

Dark-factory mode (ADR-016) lets a repo's Lore tasks auto-merge with no human
PR review. Toggling it on, widening the auto-merge path allowlist, or weakening a
`require_*` guard are exactly the changes an attacker (or a careless admin) would
make to bypass review. An admin token alone is not enough authorization for those
privileged fields: the route layers a second key — an open PR labeled
`dark-factory-approval` whose label was applied by a CODEOWNER of the repo's
`CLAUDE.md`. `GET` reads the resolved settings; `PUT` merges a partial patch,
gating privileged-field changes behind that two-key ceremony and recording every
mutation in the audit log.

## Interface

Registered with a path-only matcher
(`/^\/api\/repos\/[^/]+\/[^/]+\/settings\/dark-factory(\?|$)/`, both verbs route
in; method resolved inside)
([registration](../../../apps/mcp-server/src/api/routes/index.ts#L71)).

- **Auth (key 1)**: `admin` scope. `getRequiredScope` matches the
  `SCOPE_OVERRIDES` entry before the generic prefix map, so this route demands
  `admin` (not the `read` a bare `/api/repos/...` prefix would imply)
  ([override](../../../apps/mcp-server/src/api/routes/auth.ts#L62)). Enforced by the
  dispatcher before the handler.
- **Auth (key 2)**: the two-key ceremony, applied *inside* the handler only when
  `twoKeyFieldsTouched(patch)` is non-empty (PUT). Driven by the
  `X-Lore-Approval-PR` header and `verifyApproval`
  ([authz](../../../apps/mcp-server/src/features/dark-factory/dark-factory-authz.ts#L69)).
- **Path params**: `owner`, `repo` — URL-decoded, joined as `owner/repo`.

### `GET` — resolved settings

- Request: none.
- Response: `200 <resolved settings JSON>`; `404 { error: "repo not onboarded",
  repo }` when the repo has no settings; `500 { error: "internal" }` on a
  resolution throw.

### `PUT` — patch settings

- Request body (JSON, ≤1 MB): a partial `DarkFactorySettings` patch.
- Optional header `X-Lore-Approval-PR: owner/repo#N` (required when the patch
  touches a privileged field).
- Response: `200 { ok: true, applied, ceremony }`; or `400` (bad body / invalid
  settings); `403` (`two_key_required` | `codeowners_check_failed`); `503`
  (`github_api_unavailable`); `404` (repo vanished mid-transaction); `500`
  (`internal`).

### Other methods

`405 { error: "method not allowed" }`.

## Behavior

### Common

1. **Pool gate** — null pool → `503 { error: "database unavailable" }`.
2. Match the path regex; `owner = decode(m[1])`, `repoName = decode(m[2])`,
   `repo = "owner/repoName"`.
3. Dispatch on method: `GET` → §GET; `PUT` → §PUT; else
   `405 { error: "method not allowed" }`.

### GET (`handleGetDarkFactorySettings`)

1. `project = await projectFor(repo)`; `settings = await
   project.settings.resolveOrNull()`.
2. `settings === null` → `404 { error: "repo not onboarded", repo }`.
3. Otherwise `200 settings`.
4. Any throw → log + `500 { error: "internal" }`.

### PUT (`handlePutDarkFactorySettings`)

1. `readJsonBody(req)` — parse failure or >1 MB body → `400 { error:
   "invalid_body", detail }`.
2. `parseDarkFactorySettings(body)` (Zod) → on failure, `400 { error:
   "invalid_settings", issues }` where `issues` is the Zod `issues` array if
   present, else the error message.
3. **Two-key gate** — `twoKey = twoKeyFieldsTouched(patch)`. Default
   `ceremony = { tier: "admin" }`. If `twoKey.length > 0`:
   1. Read `X-Lore-Approval-PR` header. Missing/empty → `403 { error:
      "two_key_required", field_paths: twoKey, detail: "Privileged fields require
      an X-Lore-Approval-PR header. Reference an open PR labeled
      \`dark-factory-approval\` by a CODEOWNER." }`.
   2. `octokit = await getOctokit()`; `evidence = await verifyApproval({ octokit,
      prRef, targetRepo: repo })`.
   3. On success set `ceremony = { tier: "two_key", pr_ref, approver, pr_url }`.
   4. On `TwoKeyError` → `403 { error: "codeowners_check_failed", code, detail }`.
   5. On any other throw → log + `503 { error: "github_api_unavailable" }`.
4. **Persist (transaction)**: `client = await pool.connect()`; `BEGIN`.
   1. `SELECT settings FROM lore.repos WHERE full_name = $1 FOR UPDATE`. No row →
      `ROLLBACK` + `404 { error: "repo not onboarded", repo }`.
   2. `settings = row.settings ?? {}`; `prev = settings.dark_factory ?? {}`;
      `next = { ...prev, ...patch }`. If `patch.auto_merge`, deep-merge it:
      `next.auto_merge = { ...(prev.auto_merge ?? {}), ...patch.auto_merge }`.
      `settings.dark_factory = next`.
   3. `UPDATE lore.repos SET settings = $1 WHERE full_name = $2`.
   4. **Audit (best-effort)**: `INSERT INTO pipeline.audit_log (event_type, repo,
      payload) VALUES ('dark_factory_setting_changed', $1, $2)` with payload
      `{ field_paths_changed: keys(patch), two_key_fields: twoKey, prev, next,
      ceremony }`. A failure is swallowed — it does not block the update.
   5. `COMMIT`; respond `200 { ok: true, applied: next, ceremony }`.
   6. Any throw in the block → `ROLLBACK` (swallowed if it itself throws) + log +
      `500 { error: "internal" }`. `client.release()` in `finally`.

### Two-key verification (`verifyApproval`, dark-factory-authz.ts)

1. Parse `prRef` as `owner/repo#N` — malformed → `TwoKeyError(invalid_pr_ref)`.
2. PR repo must equal `targetRepo` → else `TwoKeyError(wrong_repo)`.
3. `pulls.get` — 404 → `pr_not_found`; other error → `github_api`.
4. PR state must be `open` → else `pr_state`.
5. `issues.listEvents` → find the `labeled` event whose label is
   `dark-factory-approval`; none → `label_missing`. `approver = event.actor.login`.
6. Fetch CODEOWNERS (`.github/CODEOWNERS`, `CODEOWNERS`, `docs/CODEOWNERS` in
   order). `isCodeowner(approver, …)` must be true; else `approver_not_codeowner`
   (or `team_membership_unresolved` when CODEOWNERS lists only `@org/team`
   handles).
7. Success → `{ prRef, approver, prUrl }`.

## Response strings (verbatim)

The full response/behavior matrix — each status, body, and the test that validates
it — is the [§Acceptance Criteria](#acceptance-criteria) below; the exact literal
strings the route emits are: `"database unavailable"`, `"method not allowed"`, `"repo not
onboarded"`, `"invalid_body"`, `"invalid_settings"`, `"two_key_required"`,
`"codeowners_check_failed"`, `"github_api_unavailable"`, `"internal"`; the
ceremony tiers `"admin"` / `"two_key"`; the audit `event_type`
`"dark_factory_setting_changed"`; the approval label `"dark-factory-approval"`;
the header `X-Lore-Approval-PR`.

## Dependencies & side effects

- Handler: `handleDarkFactorySettingsRoute`
  ([code](../../../apps/mcp-server/src/api/routes/dark-factory.ts#L16)).
- `projectFor(repo).settings.resolveOrNull()` (GET read path).
- `parseDarkFactorySettings` / `twoKeyFieldsTouched` from
  `features/dark-factory/dark-factory-settings.ts`.
- `verifyApproval` / `TwoKeyError` from
  `features/dark-factory/dark-factory-authz.ts`; `getOctokit()` from
  `platform/github-client.ts`.
- DB: `lore.repos.settings` JSONB (`SELECT … FOR UPDATE`, `UPDATE`) inside a
  transaction; best-effort `INSERT INTO pipeline.audit_log`.
- The CODEOWNERS-approval-PR ceremony reads from GitHub: `pulls.get`,
  `issues.listEvents`, `repos.getContent` (CODEOWNERS file).
- `readJsonBody` from `http.ts` (1 MB cap).

## Acceptance Criteria

A null pool returns `503 { error: "database unavailable" }`. ([validated by
`returns 503 when pool is null`](../../../apps/mcp-server/src/api/routes/dark-factory.test.ts#L63))

Any method other than GET/PUT returns `405 { error: "method not allowed" }`.
([validated by `returns 405 for unsupported
methods`](../../../apps/mcp-server/src/api/routes/dark-factory.test.ts#L69))

GET on an un-onboarded repo returns `404 { error: "repo not onboarded", repo }`.
([validated by `returns 404 when the repo is not
onboarded`](../../../apps/mcp-server/src/api/routes/dark-factory.test.ts#L85))

GET returns the resolved dark-factory settings. ([validated by `returns the
resolved dark_factory settings`](../../../apps/mcp-server/src/api/routes/dark-factory.test.ts#L92))

A GET resolution throw degrades to `500 { error: "internal" }`. ([validated by
`returns 500 when resolution throws`](../../../apps/mcp-server/src/api/routes/dark-factory.test.ts#L99))

PUT with an unparseable or oversized body returns `400 { error: "invalid_body" }`.
([validated by `returns 400 on invalid
JSON`](../../../apps/mcp-server/src/api/routes/dark-factory.test.ts#L119))

PUT with a schema-invalid patch returns `400 { error: "invalid_settings", issues }`.
([validated by `returns 400 with issues when schema validation
fails`](../../../apps/mcp-server/src/api/routes/dark-factory.test.ts#L131))

A non-privileged PUT applies at `tier: "admin"` and writes the audit log.
([validated by `applies an admin-tier change and writes the audit
log`](../../../apps/mcp-server/src/api/routes/dark-factory.test.ts#L147))

PUT deep-merges the nested `auto_merge` object over prior settings. ([validated by
`merges the nested auto_merge
object`](../../../apps/mcp-server/src/api/routes/dark-factory.test.ts#L154))

A privileged-field PUT with no `X-Lore-Approval-PR` header returns `403 { error:
"two_key_required" }`. ([validated by `returns 403 when a two-key field lacks the
approval header`](../../../apps/mcp-server/src/api/routes/dark-factory.test.ts#L168))

A privileged-field PUT applies at `tier: "two_key"` after a passing CODEOWNERS
approval. ([validated by `applies a two-key change after CODEOWNERS
approval`](../../../apps/mcp-server/src/api/routes/dark-factory.test.ts#L175))

A failed CODEOWNERS check returns `403 { error: "codeowners_check_failed", code }`.
([validated by `returns 403 on a CODEOWNERS check
failure`](../../../apps/mcp-server/src/api/routes/dark-factory.test.ts#L185))

A non-`TwoKeyError` GitHub failure returns `503 { error: "github_api_unavailable" }`.
([validated by `returns 503 when the approval check hits a GitHub
error`](../../../apps/mcp-server/src/api/routes/dark-factory.test.ts#L193))

A repo deleted between auth and the `FOR UPDATE` read returns `404`. ([validated by
`returns 404 when the repo vanishes inside the
transaction`](../../../apps/mcp-server/src/api/routes/dark-factory.test.ts#L201))

A best-effort audit-log insert failure does not block the settings commit.
([validated by `commits even when the audit-log insert
fails`](../../../apps/mcp-server/src/api/routes/dark-factory.test.ts#L208))

A write failure rolls the transaction back and returns `500 { error: "internal" }`.
([validated by `rolls back and returns 500 on a write
failure`](../../../apps/mcp-server/src/api/routes/dark-factory.test.ts#L215))

The route requires `admin` scope via the `SCOPE_OVERRIDES` override. ([validated by
`returns admin for the dark-factory settings route via
override`](../../../apps/mcp-server/src/api/routes/auth.test.ts#L21) and `applies the
dark-factory admin scope override (403 for a read
token)`](../../../apps/mcp-server/src/api/routes/dispatch.test.ts#L181))

The live `verifyApproval` GitHub interactions (PR fetch, label-event lookup,
CODEOWNERS resolution) are exercised at the handler level only through a mocked
Octokit; the real GitHub round-trip is not asserted end-to-end. *(untested: the
approval ceremony requires a live GitHub App token and a real open PR with a
CODEOWNER-applied label; `dark-factory.test.ts` injects a mocked `verifyApproval`
result and a `TwoKeyError` to cover both branches, but does not hit the GitHub
API.)*

## Out of Scope

- The `DarkFactorySettings` Zod schema + `resolveSettings()` defaults — owned by
  `dark-factory-settings.ts` and its `@re-cinq/lore-shared` canonical source.
- The internal correctness of `verifyApproval` (PR-ref parsing, CODEOWNERS
  parsing, team-handle handling) — owned by `dark-factory-authz.ts`.
- The cluster/repo two-gate enablement of dark-factory *execution*
  (`LORE_DARK_FACTORY_CLUSTER_ENABLED`) — a runtime concern, not this route.
- Auto-merge decisioning — `agent/src/jobs/auto-merge.ts`.
