# MCP Transport Options — Decision Brief

> **OBSOLETE (2026-06-23, ADR-030).** The `MCP_TRANSPORT` switch this brief
> discusses no longer exists. The remote surface was split into its own plain
> HTTPS REST app (`apps/lore-api`) and the local stdio MCP adapter
> (`apps/mcp-server`) into a separate deployable; neither carries a transport
> mode. Kept for historical context only. See
> [ADR-030](../adrs/ADR-030-split-local-remote-api.md).

**Status:** Undecided — options only. No code committed.
**Date:** 2026-06-17
**Context:** Triggered by "can we make the remote MCP an HTTP server?" The
answer turned out to be "it already is" — this brief records what's true today
and the three forward paths, so the choice can be made deliberately later.

## What's actually true today

The Lore MCP server is **one codebase, two deployments**, switched by
`LORE_DB_HOST` ([index.ts:24](../apps/mcp-server/src/index.ts#L24)) and
`MCP_TRANSPORT` ([transports.ts:11](../apps/mcp-server/src/server/transports.ts#L11)).

The **remote (GKE) instance already serves the MCP protocol over Streamable
HTTP** — [http-server.ts:28](../apps/mcp-server/src/server/http-server.ts#L28)
routes `/mcp` to the MCP transport and everything else to the `/api/*` REST
handlers:

```
GET/POST /mcp     → StreamableHTTPServerTransport   (full MCP protocol)
*/api/*           → handleApiRoute                  (REST endpoints)
```

So the remote exposes **both** an MCP-over-HTTP endpoint (`/mcp`) and a REST API
(`/api/*`).

**The catch:** Claude Code does not use `/mcp`. It connects to a **local stdio
server** on the laptop, which proxies to the **`/api/*` REST routes** — not to
`/mcp`. The MCP-over-HTTP endpoint exists but is currently unused by the client.

```
Today:   Claude Code --stdio--> local server --REST /api/*--> GKE
Unused:  Claude Code ----------------- /mcp ----------------> GKE
```

### Is `/mcp` used by any client? No — served-but-dormant.

- `install.sh` registers the client as a **stdio subprocess**, not a remote URL
  ([install.sh:135](../scripts/install.sh#L135): `claude mcp add lore-context node …/index.js`).
  Every developer connects via local stdio → REST `/api/*`. No client registers
  the `/mcp` URL; no proxy helper targets it (they hit `/api/*`).
- GKE **does** serve `/mcp` in production
  ([mcp-helm/values.yaml:32](../infra/terraform/modules/gke-mcp/lore-platform/charts/mcp-helm/values.yaml#L32):
  `MCP_TRANSPORT: http`) — the endpoint is live but has no consumer.
- It is **not** a random decision: it was a deliberate Phase 1 deliverable
  ([1-lore-platform/plan.md:34](../specs/1-lore-platform/plan.md#L34) HTTP-transport
  row; [tasks.md:85](../specs/1-lore-platform/tasks.md#L85) T017). The server half
  shipped; the client side adopted the stdio→REST path instead and never wired
  `/mcp`.
- **Implication for Options B/C:** the server half already exists and runs.
  Activating direct `/mcp` is client-side work (install.sh + OAuth), not a new
  backend build.

## Why the local server is not just a tunnel

Three responsibilities **must** run on the laptop and cannot move to GKE:

1. **Repo auto-detection** — `detectCurrentRepo()` reads the local git remote to
   know which repo you're in. Powers every tool's "auto-detected if omitted".
   A remote server cannot see your working directory.
2. **Local task / test execution** — `lore_run_task_locally`, `lore_list_tests`,
   `lore_run_test` run in the local trusted sandbox (worktrees, the developer's
   subscription, the repo's own test runner). The GKE server **refuses** these
   (`executionRefusal` keyed on `LORE_DB_HOST`).
3. **Session tracking** — tool-call capture → episode extraction happens in the
   local process on exit.

Any path that drops the local server loses these.

## The three options

### Option A — Keep local proxy, add the read-through cache
The plan in [specs/local-read-cache/spec.md](../specs/local-read-cache/spec.md).
Local stdio proxy stays; read-only proxied tools cache to `~/.lore/cache/` with
a TTL, serve stale-but-labeled when GKE is unreachable, mutations invalidate.

- **Pros:** real offline mode; lower latency on hot reads; no install/auth
  changes; keeps repo-detection + local exec + session tracking intact.
- **Cons:** the cache is new code to maintain; reads can lag the DB by a TTL.

### Option B — Wire Claude Code directly to remote `/mcp`
Reconfigure `install.sh` so Claude Code registers the remote `/mcp` URL as a
remote MCP server (native OAuth), dropping the local stdio shim.

- **Pros:** no proxy shim; always-fresh reads; native OAuth; uses the endpoint
  that already exists.
- **Cons:** **no offline mode at all**; **loses repo auto-detection**, **local
  task/test execution**, and **session tracking**; every call is a network hop.
  These losses are severe — this option is only viable if those features are
  abandoned or relocated.

### Option C — Hybrid (Anthropic's recommended shape)
Connect Claude Code **directly to remote `/mcp`** for the heavy context/memory
reads, **and** keep a **thin local stdio server** registered for the local-only
tools (repo-detection, local exec, session tracking).

- **Pros:** fresh reads with native OAuth where it helps; preserves the
  local-only capabilities; matches MCP guidance (remote backend + thin local
  layer).
- **Cons:** two MCP servers registered in Claude Code; most wiring work; still
  no offline mode for the remote-served reads (could add Option A's cache to the
  thin local server later).

## Comparison

| | A · proxy + cache | B · direct `/mcp` | C · hybrid |
|---|---|---|---|
| Offline mode | yes | no | no (reads) |
| Read latency | cached | network | network |
| Repo auto-detect | yes | no | yes |
| Local task/test exec | yes | no | yes |
| Session tracking | yes | no | yes |
| Native OAuth, no shim | no | yes | partial |
| Install/auth changes | none | yes | yes |
| Build effort | medium | medium | high |

## Recommendation (for whoever decides)

If **resilience / offline** is the priority → **Option A**. It is the only
option that survives a backend outage, and it touches nothing outside the
local instance.

If **freshness + standards alignment** is the priority and the offline gap is
acceptable → **Option C**, later augmented with Option A's cache on the thin
local server.

**Option B is not recommended** standalone: the loss of repo-detection and local
execution outweighs the simplicity gain.

## Decision

**Keep the adapter pattern (status quo) + Option A cache + remove dead `/mcp`** —
decided 2026-06-17. (This reverses an earlier same-day lean toward Option C,
after a colleague pointed out the cleaner framing.)

The local stdio MCP server is the **sole MCP surface**; it wraps the remote HTTP
REST routes into MCP tools. The backend stays a plain authenticated REST API.
We do **not** connect Claude Code directly to a remote MCP server.

Rationale:
- **Repo-detection is intrinsically local** ([repo-detect.ts:8](../apps/mcp-server/src/features/repo/repo-detect.ts#L8)
  reads the local git remote), so the highest-value tools must stay local
  regardless — direct-connect can't serve them.
- **The backend is fundamentally REST.** One auth scheme on `/api/*`, consumed
  by the local MCP, the web-ui, and CI alike. MCP-ifying it buys nothing.
- **Option C's payoff was marginal** (3 reads skipping one hop) against real
  cost (securing `/mcp`, a role split, two registered servers, no offline).

Actions:
1. **Option A** — build the local read-through cache for offline + latency:
   [specs/local-read-cache/spec.md](../specs/local-read-cache/spec.md).
2. **Remove the dormant `/mcp` endpoint** from the backend — it is unused dead
   code and an unauthenticated surface; deleting closes the gap outright.

Option C (hybrid) is **rejected**; spec kept for the record at
[specs/hybrid-remote-mcp/spec.md](../specs/hybrid-remote-mcp/spec.md).
Direct `/mcp` would only become worthwhile if non-Claude-Code clients ever need
to consume Lore tools over the network — not a current need.
