# Definition of Done

> The sidecar exists, but both agent-definition PUT bodies use AgentInputSchema while runtime validates AgentPatchSchema. Export/reuse the patch schema, preserve optional patch fields without create defaults, and regenerate OpenAPI JSON and web API types.

**Strategy: `mechanical`** — The wire schemas and documentation were incorrectly bound to the input schema instead of the patch schema. The fix is a direct edit to the sidecar mapping and a regeneration of the artifacts. Existing behavioral tests pin the runtime expectations and prove no regressions. The green bar is CI's to show (the `check` job runs tests), as local tests are blocked by pod memory limits preventing the workspace build.

## Done when these pass

- [ ] **Agent behavioral tests** — Existing tests must stay green to prove no regressions.
  `apps/lore-api/src/transport/routes/agent-definitions/agents-route.test.ts`

## Facets

- [x] Export `AgentPatchSchema` and use it in `domain-routes.ts` for PUT routes.
- [x] Regenerate `openapi.json` to make `name` optional and remove create defaults.
- [x] Regenerate client schema types in `apps/web-ui` and `apps/mcp-server`.

## Out of scope

- Runtime route logic or adding new validation rules.