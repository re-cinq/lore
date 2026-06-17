# Spec: Local Read-Through Cache

**Status:** Implemented — 2026-06-17

## Problem

The local MCP server (stdio adapter) proxies every read to the GKE backend
over `LORE_API_URL`. Repeated reads within a session (context assembly,
memory search, graph queries, trace lookups, finished-job logs) pay the full
network round-trip each time, and a transient backend blip turns an otherwise
serviceable read into a hard failure.

## Goal

A small, local, on-disk read-through cache for the stdio proxy that:

- skips the network on fresh hits,
- serves a labeled stale copy when the backend is genuinely unreachable, and
- is **derived data, never authority** — its loss or corruption degrades to a
  re-fetch, never to a wrong or stale-past-an-authorization answer.

## Non-Goals

- Caching on the GKE server path (the server has the DB; only the laptop
  adapter caches).
- Caching mutations, or any cross-developer/shared cache (each developer's
  `~/.lore/cache/` is private).
- Encryption at rest beyond owner-only file permissions.

## Design

- **Location:** `~/.lore/cache/entries/*.json` (override with `LORE_CACHE_DIR`),
  one JSON file per entry. Owner-only: dir `0700`, files `0600`.
- **Key:** `sha256(tool + \x00 + canonical(args) + \x00 + repo)`. The `\x00`
  field delimiter cannot appear in a tool name or in JSON-escaped canonical
  output, so no arg value can forge a cross-field collision. `canonical()`
  sorts object keys and drops `undefined`, so argument order never changes the
  key. The delimiter is written as the `\x00` escape (not a raw byte) to keep
  the source reviewable as text.
- **TTL:** per-tool `ttlSeconds` on the policy, optionally overridden per tool
  by `ttl_overrides` in `~/.lore/cache/config.json`.
- **Eviction:** when entry count exceeds `max_entries` (default 2000), the
  oldest entries (by `storedAt`) are removed.
- **Enablement:** `LORE_CACHE_ENABLED=false|true` wins over `config.json`'s
  `enabled` (default enabled).
- **Wrapper:** `withReadCache(policy, doProxy, opts)` in `deps.ts` —
  fresh hit short-circuits; on `ok` it stores (gated by `opts.cacheIf`); on
  `unreachable` it serves a labeled stale entry if one exists; on `denied`
  (401/403) it serves nothing and surfaces the denial.

## Functional behavior

The proxy classifies a non-2xx backend response into one of:
`unreachable` (network error, timeout, retriable 5xx, or non-auth 4xx),
`denied` (401/403), or `not_configured` (no `LORE_API_URL`). Only
`unreachable` may fall back to a stale cached copy.

## Acceptance Criteria

1. **AC1** The cache is active only in local stdio mode (memory DB
   unavailable); the GKE server read path never caches.
2. **AC2** `LORE_CACHE_ENABLED=false` disables all cache reads and writes;
   `=true` and `config.json`'s `enabled` are respected otherwise.
3. **AC3** A fresh entry (`age < ttl`) is returned without a network call,
   prefixed with a `lore-cache: HIT` marker (for labeled callers).
4. **AC4** A successful proxied read is stored under
   `sha256(tool + \x00 + canonical(args) + \x00 + repo)`; argument ordering
   does not change the key.
5. **AC5** Entries are repo-isolated: a read scoped to repo A is never served
   for repo B.
6. **AC6** When the backend is unreachable (network/timeout/5xx), an expired
   entry is served with a `lore-cache: STALE` marker rather than erroring.
7. **AC7** On an authoritative access denial (HTTP 401/403), no cached copy
   is served — fresh or stale — and the denial is surfaced to the caller.
8. **AC8** Per-tool TTLs apply; `ttl_overrides[tool]` in `config.json`
   overrides the policy TTL, including an override of `0`.
9. **AC9** When entry count exceeds `max_entries` (default 2000), the oldest
   entries are evicted.
10. **AC10** Mutations are never cached and invalidate the reads they affect:
    memory write/delete → memory reads + `assemble_context`; episode write →
    `search_memory` + `query_graph` + `assemble_context`; create task → task
    lists; ingest files → `assemble_context` for the repo.
11. **AC11** Finished-job log reads (`lore_get_task_logs`, `lore_get_job_logs`)
    are cached only when the response reports `complete: true`, with a 24h TTL.
12. **AC12** The cache is derived, never authority: a missing or corrupt entry
    degrades to a network re-fetch (never an error or wrong answer), and cache
    files are owner-only (`0600`) under an owner-only (`0700`) directory.
