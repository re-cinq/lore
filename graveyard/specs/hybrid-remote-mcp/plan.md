# Implementation Plan: Hybrid Remote MCP

Spec: [spec.md](spec.md).

## Strategy

Ship in four phases, **server-side before client-side**, so the dormant `/mcp`
becomes safe (authenticated) and role-aware *before* any developer is wired to
it. Each phase is independently testable and leaves the system working.

## Phase 1 — Role-based tool registration (server, no behavior change)

Introduce `LORE_MCP_ROLE` (`local` | `remote`, default `local`). Tag every tool
with the role(s) that should expose it; `build-mcp-server.ts` registers only the
matching subset.

- Default `local` reproduces today's tool set **minus** the three global reads
  only when explicitly split — so to avoid breaking current single-server
  installs before `install.sh` re-runs, `local` keeps registering everything in
  this phase; the *removal* of the three globals from `local` lands together
  with the install.sh change in Phase 3 (guarded so old installs keep working).
- Key decision: tag tools via a small `{ tool, roles }` registry rather than
  scattering env checks inside each `server.tool(...)` call.

Tests: registration returns the expected tool names per role.

## Phase 2 — Authenticate `/mcp` (server)

Extract the bearer-scope verifier from `api/routes/auth.ts` into a reusable
check and apply it in `http-server.ts` for the `/mcp` path before
`transport.handleRequest`. Require `read` scope. Add `Origin` validation.

- Reject missing/invalid token → 401/403 with a JSON error.
- Legacy single-token (`LORE_INGEST_TOKEN`) and scoped tokens both accepted
  (same as `/api/*`).

Tests: `/mcp` without token → 401; with `read` token → handled.

## Phase 3 — Wire the client (install.sh)

- Register `lore-global` as a remote MCP server pointing at
  `${LORE_API_URL}/mcp` with the bearer header.
- Set `LORE_MCP_ROLE=local` on the existing stdio `lore` server and flip its
  registration to exclude the three global reads (now served remotely).
- Idempotent: `claude mcp remove`/`add` guards as already used for `lore-context`.

Tests: dry-run of the install snippet registers two servers, no duplicates.

## Phase 4 — Deploy config + docs

- `mcp-helm/values.yaml`: `LORE_MCP_ROLE: remote`.
- Update `docs/mcp-tools.md` with a "served where" column.
- Smoke: deployed `/mcp` reachable with auth; global read flows direct.

## Key Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Repo strategy | Repo-scoped tools stay local | `detectCurrentRepo` is git-local; can't run on GKE |
| Auth on `/mcp` | Bearer `read` scope (v1) | Reuses existing token infra; OAuth 2.1 deferred |
| Tool split size | 3 global reads only | Minimal, safe, extensible proving ground |
| Default role | `local` | Backward-compatible; old installs unaffected until re-run |
| Offline | Not addressed for remote | Out of scope; Option A cache covers local tools |

## Risks

- **Duplicate tool names** if both servers register a tool → disjoint sets +
  a test asserting no overlap.
- **Old installs** keep a single server until `install.sh` re-runs → default
  `local` must keep working standalone; never hard-depend on `lore-global`.
- **Auth regression on `/api/*`** when refactoring the verifier → extract
  without changing `/api/*` behavior; keep its tests green.
- **`claude mcp add --transport http` syntax / OAuth** drift → confirm against
  current Claude Code docs at Phase 3 build time before finalizing install.sh.

## Out of scope

OAuth 2.1, remote-side caching/offline, migrating repo-scoped or write tools to
remote, multi-region `/mcp`.
