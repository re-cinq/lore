# Tasks: Hybrid Remote MCP

Spec: [spec.md](spec.md) · Plan: [plan.md](plan.md)

## Phase 1 — Role-based tool registration

- [ ] T001 Add `LORE_MCP_ROLE` parsing (`local`|`remote`, default `local`) in `apps/mcp-server/src/server/build-mcp-server.ts`
- [ ] T002 Define a tool→role registry (3 global reads = `remote`; rest = `local`) and filter registration by active role in `apps/mcp-server/src/server/build-mcp-server.ts`
- [ ] T003 [P] Tests: `build-mcp-server.test.ts` asserts the tool set per role and **no overlap** between roles

## Phase 2 — Authenticate `/mcp`

- [ ] T004 Extract a reusable `read`-scope bearer verifier from `apps/mcp-server/src/api/routes/auth.ts` (no change to `/api/*` behavior)
- [ ] T005 Gate `/mcp` in `apps/mcp-server/src/server/http-server.ts` with the verifier + `Origin` validation before `transport.handleRequest`
- [ ] T006 [P] Tests: `/mcp` without token → 401; invalid scope → 403; valid `read` token → handled

## Phase 3 — Client wiring

- [ ] T007 In `scripts/install.sh`, set `LORE_MCP_ROLE=local` on the stdio `lore` server and exclude the 3 global reads from it
- [ ] T008 In `scripts/install.sh`, register `lore-global` via `claude mcp add --transport http "${LORE_API_URL}/mcp"` with bearer header; idempotent remove/add guards
- [ ] T009 Verify current `claude mcp add` remote/OAuth syntax against Claude Code docs before finalizing T008

## Phase 4 — Deploy config + docs

- [ ] T010 Set `LORE_MCP_ROLE: remote` in `infra/terraform/modules/gke-mcp/mcp-helm/values.yaml`
- [ ] T011 [P] Update `docs/mcp-tools.md` with a "served where" (local/remote) column
- [ ] T012 Smoke check: deployed `/mcp` reachable only with auth; `lore_search_memory` flows direct (trace/log confirms no local hop)

## Acceptance gate

- [ ] All 12 spec acceptance criteria pass
- [ ] `yarn tsc` + `yarn eslint` + tests green in `apps/mcp-server`
