# Feature Specification: Hybrid Remote MCP (activate `/mcp`)

| Field          | Value                                    |
|----------------|------------------------------------------|
| Feature        | Hybrid Remote MCP — direct-connect for global reads |
| Status         | Rejected (2026-06-17) — see note below   |
| Created        | 2026-06-17                               |
| Owner          | Platform Engineering                     |
| Related        | [docs/mcp-transport-options.md](../../docs/mcp-transport-options.md), [docs/mcp-tools.md](../../docs/mcp-tools.md) |

> **REJECTED.** The right architecture is the **adapter pattern Lore already
> uses**: the local stdio MCP server is the sole MCP surface and wraps the
> remote HTTP REST routes into MCP tools; the backend stays a plain REST API.
> Direct-connect to `/mcp` buys little here — repo-detection is intrinsically
> local (so the highest-value tools must stay local anyway), the backend is
> fundamentally REST, and the gain was 3 read tools skipping one hop against the
> cost of securing `/mcp`, a role split, and two registered servers. Kept for
> the record. Forward path: local read-through cache
> ([../local-read-cache/spec.md](../local-read-cache/spec.md)) + removal of the
> dormant `/mcp` endpoint. See [../../docs/mcp-transport-options.md](../../docs/mcp-transport-options.md).

## Problem Statement

The GKE MCP server already serves the MCP protocol over Streamable HTTP at
`/mcp` ([http-server.ts:28](../../apps/mcp-server/src/server/http-server.ts#L28)),
but **no client uses it**. Every developer's Claude Code connects to a **local
stdio** server that proxies to the REST API (`/api/*`). The `/mcp` endpoint is a
deliberate Phase 1 deliverable ([1-lore-platform/plan.md:34](../1-lore-platform/plan.md#L34))
that the client side never adopted — it is live but dormant.

Routing global reads through the local proxy adds a hop and gives no benefit:
`lore_search_memory`, `lore_read_memory`, and `lore_query_graph` are
**repo-agnostic** — they need no local git context — yet they still bounce
stdio → REST → DB. Connecting Claude Code directly to `/mcp` for these would be
fresher, standards-aligned (native remote MCP + OAuth), and would finally put
the dormant endpoint to use.

Two reasons the *whole* server can't move remote — and why this is a **hybrid**:

1. **Repo auto-detection is local.** [repo-detect.ts:8](../../apps/mcp-server/src/features/repo/repo-detect.ts#L8)
   runs `git remote get-url origin` in the developer's working directory; it
   returns `null` on GKE. Every repo-scoped tool (`lore_assemble_context`, …)
   depends on it, so those **stay local**.
2. **Local-only capabilities.** Local task/test execution and session tracking
   must run on the laptop. They **stay local**.

## Solution

Run **two MCP servers** registered in Claude Code, from the **same codebase**,
selected by a new `LORE_MCP_ROLE` env var:

| Server | Transport | Role | Tools |
|---|---|---|---|
| `lore` (existing) | stdio (local) | `local` | repo-scoped + local-exec + writes + session tracking |
| `lore-global` (new) | Streamable HTTP → remote `/mcp` | `remote` | repo-agnostic global reads |

The GKE deployment keeps serving `/api/*` (the local server still proxies
repo-scoped reads/writes there) **and** now exposes an **authenticated** `/mcp`
for the global read tools.

### Tool split (v1 — deliberately minimal)

**Migrate to remote `/mcp` (`role=remote`):**

| Tool | Why it qualifies |
|---|---|
| `lore_search_memory` | Org-wide semantic search; no repo, no local state |
| `lore_read_memory` | Keyed by `key` + `agent_id`; no repo |
| `lore_query_graph` | Entity/relation query; `repo` already optional |

**Stay local (`role=local`):** everything else —
`lore_assemble_context`, `lore_search_context`, `lore_list_memories`,
`lore_write_memory`, `lore_delete_memory`, `lore_write_episode`, all pipeline
tools, repo tools, spec-trace tools, and the local-exec tools
(`lore_run_task_locally`, `lore_list_tests`, `lore_run_test`).

Disjoint sets → no duplicate tool names in Claude Code. The split is data-driven
and extensible: more tools can migrate later by changing their role tag.

### Authentication on `/mcp`

Today `/mcp` bypasses auth. v1 gates it with the **existing bearer-token
scheme** (`pipeline.api_tokens`, `read` scope) — the same tokens `/api/*` uses —
checked in `http-server.ts` before `transport.handleRequest`. Claude Code's
remote MCP registration passes it as an `Authorization: Bearer` header.

OAuth 2.1 (the MCP-spec-recommended end state) is **out of scope for v1** and
tracked as a follow-up; bearer-scoped auth reuses infrastructure that already
exists and unblocks the hybrid now.

### Architecture

```
Developer laptop                                  GKE (lore-mcp pod)
┌───────────────────────────┐                    ┌──────────────────────────┐
│ Claude Code               │                    │ MCP server (role=remote)  │
│  ├─ MCP "lore" (stdio) ───┼── REST /api/* ─────▶│  ├─ /api/*  (bearer auth) │
│  │   role=local           │                    │  │   ← repo-scoped proxy  │
│  │   repo-scoped + local  │                    │  └─ /mcp    (bearer auth) │◀─┐
│  └─ MCP "lore-global" ────┼── MCP /mcp (OAuth/──┼──────┘   global reads      │ │
│      role=remote (HTTP)   │   bearer, direct)   └──────────────────────────┘ │
└───────────────────────────┘                                                  │
                              direct connection, no local hop ─────────────────┘
```

### File Changes

| File | Change |
|------|--------|
| `apps/mcp-server/src/server/build-mcp-server.ts` | Read `LORE_MCP_ROLE`; register only the tools for the active role |
| `apps/mcp-server/src/mcp/tools/*` | Tag each tool with a role (`local` / `remote` / `both`); registration helpers filter by active role |
| `apps/mcp-server/src/server/http-server.ts` | Gate `/mcp` with bearer-scope auth before `transport.handleRequest` |
| `apps/mcp-server/src/api/routes/auth.ts` | Reuse/extract the bearer-scope verifier for the `/mcp` path |
| `scripts/install.sh` | Register a second MCP server `lore-global` (`claude mcp add --transport http <LORE_API_URL>/mcp --header …`); set `LORE_MCP_ROLE=local` on the stdio one |
| `infra/terraform/modules/gke-mcp/mcp-helm/values.yaml` | Set `LORE_MCP_ROLE: remote` on the GKE deployment |
| `docs/mcp-tools.md` | Mark which tools are served remote vs local |
| `apps/mcp-server/src/server/*.test.ts` | Tests: role-based registration, `/mcp` auth gate |

### Security

- `/mcp` requires a valid `read`-scope bearer token — closes the current
  unauthenticated-access gap (the headline risk of this whole feature).
- Validate `Origin` on `/mcp` (DNS-rebinding defense, per MCP spec) when bound
  beyond localhost.
- No new secrets on the laptop; the remote token is the existing
  `LORE_INGEST_TOKEN` / a scoped read token, stored the same way as today.
- Global read tools expose only already-org-shared, redacted data.

### Limitations

1. **No offline mode for remote tools.** Direct `/mcp` reads fail when GKE is
   unreachable — there is no local layer to fall back to. (Option A's cache
   covers the *local* tools; a remote cache is not in scope.)
2. **Modest immediate payoff.** v1 migrates only 3 read tools; the value is
   strategic (activates `/mcp`, native OAuth path, standards alignment, a
   foundation more tools can adopt) more than raw latency saved.
3. **Two servers to register.** Developers now have `lore` + `lore-global` in
   Claude Code; `install.sh` must configure both idempotently.
4. **Bearer, not OAuth, in v1.** OAuth 2.1 is the recommended end state and is
   deferred.

## Acceptance Criteria

1. With `LORE_MCP_ROLE=local`, the stdio server registers the repo-scoped +
   local-exec tools and **not** `lore_search_memory` / `lore_read_memory` /
   `lore_query_graph`.
2. With `LORE_MCP_ROLE=remote`, the server registers **only** the three global
   read tools over MCP (and continues serving `/api/*`).
3. Unset `LORE_MCP_ROLE` defaults to `local` (today's local behavior preserved;
   no tool disappears for existing installs until `install.sh` re-runs).
4. `/mcp` rejects requests without a valid `read`-scope bearer token (401/403).
5. `/mcp` accepts a valid `read`-scope bearer token and serves the global tools.
6. No duplicate tool names are exposed across the two registered servers.
7. `install.sh` registers both `lore` (stdio, role=local) and `lore-global`
   (http → `/mcp`) idempotently; re-running does not duplicate or error.
8. The GKE deployment sets `LORE_MCP_ROLE=remote` and `/mcp` is reachable with
   auth in a deployed environment.
9. A global read (`lore_search_memory`) invoked from Claude Code returns results
   via the direct `/mcp` path (no local stdio hop), confirmed by traces/logs.
10. Repo-scoped tools continue to auto-detect the repo and proxy via `/api/*`
    unchanged.
