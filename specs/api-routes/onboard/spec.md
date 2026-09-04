# Feature Specification: POST /api/onboard

| Field      | Value                                          |
|------------|------------------------------------------------|
| Feature    | Onboard repo HTTP route                         |
| Status     | In Progress                                     |
| Created    | 2026-06-10                                      |
| Owner      | Platform Engineering                           |
| Route      | `POST /api/onboard`                            |
| Auth scope | `admin`                                         |
| Module     | `mcp-server/src/api/routes/ingest.ts` (`handleOnboard`) |

POST /api/onboard brings a repo into Lore by inspecting it, opening a bootstrap PR that adds CLAUDE.md, AGENTS.md, ADRs, and CI workflows, and registering a lore.repos row for nightly ingestion.

## Problem Statement

Bringing a repo into Lore is a privileged, side-effecting operation: it inspects
the repo and opens a PR adding `CLAUDE.md`, `AGENTS.md`, ADRs, a PR template, and
CI workflows, and registers the repo for nightly ingestion. Because it writes to
an external repo and creates a `lore.repos` row, it must be gated behind the
strongest token scope. This route is the HTTP surface the `/onboard` UI and the
`lore_onboard_repo` MCP tool call.

It is also where duplicate onboarding is stopped. A fully onboarded repo used to
collect duplicate onboard tasks, each filing its own GitHub Issue and racing its
own PR (issue #968), because no entry point consulted
`lore.repos.onboarding_pr_merged` before writing.

## Interface

- **Method + path**: `POST /api/onboard`
- **Auth**: bearer token with `admin` scope. `getRequiredScope` maps the
  `/api/onboard` prefix → `admin` in `ROUTE_SCOPES`. Missing bearer → 401;
  non-admin token → 403 (dispatcher).

### Request

JSON body:

| Field | Type | Required | Default | Notes |
|-------|------|----------|---------|-------|
| `repo` | string | yes | — | Must be `owner/name` — validated by an `includes("/")` check. |
| `reonboard` | boolean | no | `false` | Deliberate repair pass over an already-onboarded repo: regenerates only the scaffolding it is missing. Waives only the already-onboarded block — never the in-flight or open-PR one. |

### Response

| Status | Body |
|--------|------|
| 200 | The `onboardRepo` result object. |
| 400 | `{ "error": "required: repo (owner/name format)" }` |
| 409 | `{ "blocked": "in-flight" \| "already-onboarded" \| "pr-open", "error": "<reason>", "task_id": "<in-flight task or null>" }` |
| 500 | `{ "error": "<err.message>" }` |
| 503 | `{ "error": "database not available" }` (pool is null). |

## Behavior

1. If `pool` is null → 503 `{ error: "database not available" }`; return.
2. Read the raw body via `readBody`.
3. `JSON.parse(body)` inside a try; failures caught at step 6.
4. Destructure `{ repo }`. If `repo` is falsy **or** `!repo.includes("/")` → 400
   with the verbatim required-fields error; return.
5. `await onboardRepo(pool, repo, { reonboard })`
   ([feature](../../../apps/mcp-server/src/features/repo/repo-onboard.js)); a result
   carrying `blocked` is a conflict with existing state rather than a failure, so
   write 409 with it — otherwise write 200 with the result.
6. **Catch** — log `[onboard] API error: <message>` and write 500
   `{ error: err.message }`.

### Duplicate guard

`onboardRepo` runs the state read and the writes in one transaction holding
`pg_advisory_xact_lock(hashtext("lore.onboard:<repo>"))`, so concurrent
submissions serialize and the later one sees the earlier one's task. ([validated by `takes the per-repo advisory lock before reading the guard state`](apps/lore-api/src/features/repo/repo-onboard.test.ts#L98))

Inside the lock the shared `decideOnboard`
([guard](../../../libs/shared/src/onboard-guard.ts)) refuses a submission whose
repo already has an onboard task in flight, has merged its onboarding PR, or has
one still open. ([validated by `blocks an already-onboarded repo without creating a task`](apps/lore-api/src/features/repo/repo-onboard.test.ts#L165), [`blocks a repo with an onboard task in flight and names that task`](apps/lore-api/src/features/repo/repo-onboard.test.ts#L176))

The `pr-open` block is self-healing: `lore.repos.onboarding_pr_url` is set when the
onboarding PR opens and cleared by the Floor's merge-check when that PR is closed
without merging, so a rejected onboarding does not refuse the repo forever. ([validated by `nulls the onboarding PR url by row id when that PR closed unmerged`](libs/shared/src/project/settings/settings-pg.test.ts#L89))

The web-ui onboard form and the repo-page re-onboard button take the same lock
through their own mirror of the guard, which decides identically. ([validated by `takes the per-repo advisory lock before reading the guard state`](apps/web-ui/src/lib/onboard.test.ts#L50), [`shares the advisory-lock key so both apps serialize on it`](apps/web-ui/src/lib/onboard-guard.parity.test.ts#L47))

## Output

- **Success**: 200, body = the `onboardRepo` result.
- **Validation failure**: 400, `{ error: "required: repo (owner/name format)" }`.
- **Duplicate submission**: 409, `{ blocked, error, task_id }`. ([validated by `returns 409 with the reason when the guard blocks the submission`](apps/lore-api/src/api/routes/repos/onboard.test.ts#L61))
- **Engine / parse error**: 500, `{ error: "<message>" }`.
- **No DB**: 503, `{ error: "database not available" }`.

## Dependencies & side effects

- `onboardRepo` (`features/repo/repo-onboard.ts`) — inspects the repo, opens a
  bootstrap PR, inserts/updates `lore.repos`. (GitHub API + DB writes.)
- Auth env `LORE_INGEST_TOKEN`, `pipeline.api_tokens` (dispatcher).

## Acceptance Criteria

A null pool returns 503 before any parsing. ([validated by `returns 503 when pool is null`](apps/lore-api/src/api/routes/repos/onboard.test.ts#L42))

A repo without a slash returns 400. ([validated by `returns 400 when repo is missing or malformed`](apps/lore-api/src/api/routes/repos/onboard.test.ts#L48))

A valid repo returns 200 with the onboard result. ([validated by `returns 200 with the onboard result`](apps/lore-api/src/api/routes/repos/onboard.test.ts#L54))

A guard-blocked submission returns 409 carrying the reason, and `reonboard` is passed through to `onboardRepo`. ([validated by `returns 409 with the reason when the guard blocks the submission`](apps/lore-api/src/api/routes/repos/onboard.test.ts#L61), [`passes reonboard through to onboardRepo`](apps/lore-api/src/api/routes/repos/onboard.test.ts#L73))

A throwing `onboardRepo` returns 500. ([validated by `returns 500 when onboardRepo throws`](apps/lore-api/src/api/routes/repos/onboard.test.ts#L82))

The route is registered as an exact `POST /api/onboard` match. ([implemented by](../../../apps/lore-api/src/server/build-server.ts#L104), [implemented by](../../../apps/lore-api/src/api/routes/repos/onboard.ts#L22))

`onboardRepo` ensures the Floor webhook for the onboarded repo and returns the ensure outcome under `webhook` in its result; onboarding still completes (returning `repo_id` + `task_id`) when the ensure is skipped. ([validated by `repo-onboard.test.ts:67`](apps/lore-api/src/features/repo/repo-onboard.test.ts#L66), [`repo-onboard.test.ts:79`](apps/lore-api/src/features/repo/repo-onboard.test.ts#L83))

`onboardRepo` takes the per-repo advisory lock before reading the guard state and gives the task a description rather than the bare repo name. ([validated by `takes the per-repo advisory lock before reading the guard state`](apps/lore-api/src/features/repo/repo-onboard.test.ts#L98), [`sends a described task instead of the bare repo name`](apps/lore-api/src/features/repo/repo-onboard.test.ts#L134))

`onboardRepo` creates no task and skips the webhook ensure for an already-onboarded repo, blocks a repo with an onboard task in flight while naming that task, and blocks a repo whose onboarding PR is still open while naming the PR. ([validated by `blocks an already-onboarded repo without creating a task`](apps/lore-api/src/features/repo/repo-onboard.test.ts#L165), [`blocks a repo with an onboard task in flight and names that task`](apps/lore-api/src/features/repo/repo-onboard.test.ts#L176), [`blocks a repo whose onboarding PR is still open`](apps/lore-api/src/features/repo/repo-onboard.test.ts#L187))

A `reonboard` submission is queued for an already-onboarded repo but still refused while an onboard task is in flight. ([validated by `creates a task for an onboarded repo when reonboard is requested`](apps/lore-api/src/features/repo/repo-onboard.test.ts#L219), [`still blocks reonboard while an onboard task is in flight`](apps/lore-api/src/features/repo/repo-onboard.test.ts#L233))

`reonboard` waives only the already-onboarded block; a repo whose onboarding PR is still open is refused, because a repair pass there would put a second agent on scaffolding the first one is still writing. ([validated by `blocks reonboard while the onboarding PR is still open`](apps/lore-api/src/features/repo/repo-onboard.test.ts#L204))

`onboardRepo` takes one pooled connection and commits both the onboard task and the `lore.repos` row inside the single transaction that holds the lock — a second connection for the task would deadlock the pool once concurrent submissions reach its size, and a task committed outside the transaction would survive the rollback and then block every retry as in-flight. A failing write rolls back, creates nothing, and skips the webhook ensure. ([validated by `commits the task and the repos row on the one locked connection`](apps/lore-api/src/features/repo/repo-onboard.test.ts#L119), [`rolls back and creates nothing when a write fails`](apps/lore-api/src/features/repo/repo-onboard.test.ts#L151))

Onboard tasks are created only here: `POST /api/task` refuses `task_type: "onboard"` and points at this route rather than routing around the guard. ([validated by `refuses task_type onboard and points at the guarded onboard route`](apps/lore-api/src/api/routes/tasks/task-post.test.ts#L333))

### fetchRepoContext

`fetchRepoContext` (`features/repo/repo-onboard.ts`) rejects a `full_name` without an `owner/repo` slash before any GitHub call. ([validated by `throws for a full_name without an owner/repo slash`](apps/lore-api/src/features/repo/repo-onboard.test.ts#L284))

It lists the top-level tree as entry names, decodes present key files from base64, and silently skips a key file on a 404 or any other fetch error. ([validated by `lists the top-level tree and decodes present key files, skipping 404s`](apps/lore-api/src/features/repo/repo-onboard.test.ts#L290))

A failed top-level listing (non-404) yields an empty tree rather than throwing. ([validated by `returns an empty tree when the top-level listing fails`](apps/lore-api/src/features/repo/repo-onboard.test.ts#L312))

It samples up to 3 source files across `SAMPLE_DIRS`, keeps only the first 200 lines of each, filters directory listings to file-type entries, and stops fetching further entries — in the same directory or the next one — once the cap is reached. ([validated by `collects up to 3 samples across dirs, filters to file entries, and stops mid-directory once full`](apps/lore-api/src/features/repo/repo-onboard.test.ts#L324))

A sample directory listing that 404s or otherwise errors is skipped, moving on to the next directory. ([validated by `skips a sample dir on 404 and on any other listing error, continuing to the next dir`](apps/lore-api/src/features/repo/repo-onboard.test.ts#L370))

A single sample file whose content fetch fails is skipped without affecting the other entries in its directory. ([validated by `skips a sample entry whose content fetch fails, keeping the other entries`](apps/lore-api/src/features/repo/repo-onboard.test.ts#L388))

## Out of Scope

- The repo inspection / bootstrap-PR generation internals (`onboardRepo`).
- Nightly ingestion scheduling.
- Bearer-token validation mechanics (owned by `auth.ts`).
