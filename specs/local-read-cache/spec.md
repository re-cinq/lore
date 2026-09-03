# Spec: Local Read-Through Cache

| Field    | Value                     |
|----------|---------------------------|
| Feature  | Local Read-Through Cache  |
| Branch   | (unassigned)              |
| Status   | In Progress               |
| Created  | 2026-06-17                |

Local Read-Through Cache adds a small on-disk cache to the stdio MCP proxy that skips the network on fresh read hits and serves a labeled stale copy when the backend is unreachable, while staying derived data whose loss degrades only to a re-fetch, never to a wrong answer.

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
`denied` (401/403), or `not_configured` (no `LORE_API_URL`/`LORE_INGEST_TOKEN`).
Only `unreachable` may fall back to a stale cached copy. ([validated by `returns not_configured when LORE_API_URL is unset`](libs/server-core/src/proxy.test.ts#L26), [`proxy.test.ts:34`](libs/server-core/src/proxy.test.ts#L34), [`proxy.test.ts:67`](libs/server-core/src/proxy.test.ts#L67), [`proxy.test.ts:82`](libs/server-core/src/proxy.test.ts#L82), [`proxy.test.ts:97`](libs/server-core/src/proxy.test.ts#L97), [validated by `folds the server error body into the detail on a non-retriable 4xx`](libs/server-core/src/proxy.test.ts#L112))

On a 2xx response the proxy returns `ok` with the upstream body serialized to a string, and forms every upstream call as a bearer-authenticated request to the configured `LORE_API_URL` endpoint. ([validated by `returns ok with the serialized body on 200`](libs/server-core/src/proxy.test.ts#L42), [validated by `forwards the bearer token and endpoint on a POST`](libs/server-core/src/proxy.test.ts#L53))

## Acceptance Criteria

1. **AC1** The cache is active only in local stdio mode (memory DB
   unavailable); the GKE server read path never caches. ([implemented by `isMemoryDbAvailable`](apps/mcp-server/src/mcp/tools/context-tools.ts#L109), [`withReadCache`](apps/mcp-server/src/mcp/tools/deps.ts#L17))

2. **AC2** `LORE_CACHE_ENABLED=false` disables all cache reads and writes;
   `=true` and `config.json`'s `enabled` are respected otherwise. ([validated by `is a no-op when LORE_CACHE_ENABLED=false`](libs/server-core/src/platform/proxy-cache.test.ts#L134), [`isCacheEnabled`](libs/server-core/src/platform/proxy-cache.ts#L117))

3. **AC3** A fresh entry (`age < ttl`) is returned without a network call,
   prefixed with a `lore-cache: HIT` marker (for labeled callers). ([validated by `returns a fresh hit within ttl`](libs/server-core/src/platform/proxy-cache.test.ts#L71), [`proxy-cache.test.ts:144`](libs/server-core/src/platform/proxy-cache.test.ts#L144))

4. **AC4** A successful proxied read is stored under
   `sha256(tool + \x00 + canonical(args) + \x00 + repo)`; argument ordering
   does not change the key. ([validated by `proxy-cache.test.ts:59`](libs/server-core/src/platform/proxy-cache.test.ts#L59), [`proxy-cache.test.ts:49`](libs/server-core/src/platform/proxy-cache.test.ts#L49), [validated by `differs when an arg value differs`](libs/server-core/src/platform/proxy-cache.test.ts#L65))

5. **AC5** Entries are repo-isolated: a read scoped to repo A is never served
   for repo B. ([validated by `isolates entries by repo`](libs/server-core/src/platform/proxy-cache.test.ts#L89), [`proxy-cache.test.ts:53`](libs/server-core/src/platform/proxy-cache.test.ts#L53))

6. **AC6** When the backend is unreachable (network/timeout/5xx), an expired
   entry is served with a `lore-cache: STALE` marker rather than erroring. ([validated by `does not return an expired entry as fresh but readAny still serves it`](libs/server-core/src/platform/proxy-cache.test.ts#L83), [`proxy-cache.test.ts:144`](libs/server-core/src/platform/proxy-cache.test.ts#L144))

7. **AC7** On an authoritative access denial (HTTP 401/403), no cached copy
   is served — fresh or stale — and the denial is surfaced to the caller. ([validated by `context-tools.test.ts:165`](apps/mcp-server/src/mcp/tools/context-tools.test.ts#L165))

8. **AC8** Per-tool TTLs apply; `ttl_overrides[tool]` in `config.json`
   overrides the policy TTL, including an override of `0`. ([implemented by `effectiveTtl`](libs/server-core/src/platform/proxy-cache.ts#L165))

9. **AC9** When entry count exceeds `max_entries` (default 2000), the oldest
   entries are evicted. ([validated by `evicts the oldest entries past max_entries`](libs/server-core/src/platform/proxy-cache.test.ts#L114), [`evictIfNeeded`](libs/server-core/src/platform/proxy-cache.ts#L260))

10. **AC10** Mutations are never cached and invalidate the reads they affect:
    memory write/delete → memory reads + `assemble_context`; episode write →
    `search_memory` + `query_graph` + `assemble_context`; create task → task
    lists; ingest files → `assemble_context` for the repo; invalidation scopes
    removal to the given repo. ([implemented by `MEMORY_DERIVED_READS`](apps/mcp-server/src/mcp/tools/memory-tools.ts#L42), [`EPISODE_DERIVED_READS`](apps/mcp-server/src/mcp/tools/memory-tools.ts#L43), [`invalidateCache`](apps/mcp-server/src/mcp/tools/pipeline-tools.ts#L89), [`invalidateCache`](apps/mcp-server/src/mcp/tools/repo-tools.ts#L97), [validated by `scopes removal to a repo when given`](libs/server-core/src/platform/proxy-cache.test.ts#L104), [validated by `removes entries for the named tool only`](libs/server-core/src/platform/proxy-cache.test.ts#L96))

11. **AC11** Finished-job log reads (`lore_get_task_logs`, `lore_get_job_logs`)
    are cached only when the response reports `complete: true`, with a 24h TTL. ([implemented by `completeOnly`](apps/mcp-server/src/mcp/tools/pipeline-tools.ts#L22), [`ttlSeconds: 86400`](apps/mcp-server/src/mcp/tools/pipeline-tools.ts#L377), [`ttlSeconds: 86400`](apps/mcp-server/src/mcp/tools/pipeline-tools.ts#L431))

11a. **AC11a** A non-retriable 4xx carries its status and raw body back to the
    caller, so an authoritative refusal (a 409 conflict) can be told apart from an
    outage instead of being reported as "unreachable, retry". ([validated by `carries the status and raw body of a non-retriable 4xx`](libs/server-core/src/proxy.test.ts#L129))

12. **AC12** The cache is derived, never authority: a missing or corrupt entry
    degrades to a network re-fetch (never an error or wrong answer), and cache
    files are owner-only (`0600`) under an owner-only (`0700`) directory. ([validated by `proxy-cache.test.ts:82`](libs/server-core/src/platform/proxy-cache.test.ts#L79), [`writeJson`](libs/server-core/src/platform/proxy-cache.ts#L94))
