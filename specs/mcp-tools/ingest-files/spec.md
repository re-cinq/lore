# Feature Specification: lore_ingest_files MCP Tool

| Field   | Value                          |
|---------|--------------------------------|
| Feature | lore_ingest_files MCP Tool          |
| Status  | Draft                          |
| Created | 2026-06-10                     |
| Owner   | Platform Engineering           |
| Tool    | `lore_ingest_files`                 |
| Module  | Repo (`repo-tools.ts`)         |
| Scope   | shared                         |

## Problem Statement

Nightly ingestion picks up a repo's content on a schedule, but a developer who
just merged a key file (a new ADR, an updated CLAUDE.md) wants it searchable via
`lore_search_context` immediately. `lore_ingest_files` lets them push specific paths into
the context store on demand. The MCP server runs locally, so the tool resolves
the repo + commit locally and proxies the embed work to the GKE ingest API.

## Interface

Registered via `server.tool` ([registration](apps/mcp-server/src/mcp/tools/repo-tools.ts#L53)).

- **name**: `lore_ingest_files`
- **description** (verbatim):

```text
Fetches specific repo files from GitHub, embeds them, and writes them into Lore's context store immediately so they are searchable without waiting for nightly ingestion. Returns "Ingested N files into Lore for <repo>. M errors." Use after merging a new ADR or updated CLAUDE.md to make it searchable now. Instead: to onboard a new repo use lore_onboard_repo; to search existing content use lore_search_context or lore_assemble_context.
```

### Input schema (Zod)

| Param | Type | Required | Default | Constraint / notes |
|-------|------|----------|---------|--------------------|
| `files` | string[] | yes | — | Repo-relative file paths to ingest. |
| `repo` | string | no | — | "owner/repo" format. Auto-detected from cwd git remote when omitted. |

## Behavior

1. **Repo resolution** — `resolvedRepo = repo || detectCurrentRepo()`. If both
   are empty, return the literal text
   `"Could not detect repo. Specify repo parameter (e.g., 're-cinq/my-service')."`
2. **Proxy config gate** — read `LORE_API_URL` + `LORE_INGEST_TOKEN`. If either
   is missing, return the literal text
   `"Ingestion requires LORE_API_URL + LORE_INGEST_TOKEN. Run install.sh to configure."`
3. **Commit resolution** — default `commit = "HEAD"`. Only when
   `detectCurrentRepo() === resolvedRepo` (i.e. the resolved repo is the one the
   developer is actually sitting in), run `git rev-parse HEAD` (5s timeout, utf-8)
   and use the trimmed SHA. For any other repo, `"HEAD"` tells GitHub to use the
   default branch. The `git rev-parse` call is wrapped in a swallow-all
   `try/catch`.
4. **Proxy POST** — `POST {LORE_API_URL}/api/ingest` with
   `Authorization: Bearer {token}`, `Content-Type: application/json`, body
   `{ files, repo: resolvedRepo, commit }`.
5. **Non-OK response** — if `!res.ok`, parse the JSON error body (falling back to
   `{ error: res.statusText }` on a parse failure) and return
   `"Ingestion failed: {error || statusText}"`.
6. **Success envelope** — parse the JSON response and return
   `"Ingested {result.ingested || 0} files into Lore for {resolvedRepo}. {result.errors || 0} errors."`
7. Any thrown error is caught and returned as `"Error: {message}"`.

## Output

A single MCP text content block. One of, in priority order: the detect-repo text,
the config-required text, the `"Ingestion failed: …"` text, the
`"Ingested N files … M errors."` success line, or the `"Error: …"` text.
**Never throws** — every path returns text.

## Dependencies & side effects

- `detectCurrentRepo()` — reads the local git remote (used for both repo
  resolution and the local-HEAD guard).
- `node:child_process` `execSync("git rev-parse HEAD")` — only when the resolved
  repo matches the local repo.
- `fetch` to `{LORE_API_URL}/api/ingest` — the actual embed work runs server-side
  on GKE; this handler does not touch Postgres directly.
- Env: `LORE_API_URL`, `LORE_INGEST_TOKEN` (both required for the proxy).
- No direct DB writes from this process — the GKE `/api/ingest` route owns the
  chunking + embedding + chunk inserts.

## Acceptance Criteria

The handler returns the detect-repo guidance when no repo is passed and detection
returns null. ([validated by `returns a detect-repo message when no repo is given and detection fails`](apps/mcp-server/src/mcp/tools/repo-tools.test.ts#L68))

The handler returns the config-required message when `LORE_API_URL` /
`LORE_INGEST_TOKEN` are unset. ([validated by `returns a config-required message when LORE_API_URL / token are unset`](apps/mcp-server/src/mcp/tools/repo-tools.test.ts#L78))

The local-HEAD commit resolution, the proxy POST, and the success / failure
framing are exercised only against a live `LORE_API_URL`. *(untested: the
success and failure branches are a pure live-IO `fetch` proxy with no injectable
seam; only the two pre-fetch guards are unit-testable.)*

## Out of Scope

- The GKE `/api/ingest` route: chunking, Vertex embeddings, chunk inserts.
- Nightly scheduled ingestion (the cron path).
- Search over ingested content — `lore_search_context`.
