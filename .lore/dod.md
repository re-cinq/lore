# Definition of Done

> The runtime registers planning lifecycle routes, but the generated OpenAPI snapshot does not list the requested plan-approve route.

**Strategy: `direct`** — The OpenAPI generator and routeList functions provide an existing seam where we can directly assert on the generated schema structure.

## Done when these pass

- [x] **OpenAPI generation for plan lifecycle routes includes dynamically registered planning lifecycle routes in the generated document** — Ensures the plan approval endpoint is present in the generated schema.
  `apps/lore-api/src/transport/openapi/gen-openapi.acceptance.test.ts`

## Facets

- [x] Incorporate plan lifecycle routes into `routeList` so the generator can discover them.
- [x] Wire the dependencies correctly for `routeList` to evaluate lifecycle route definitions.

## Out of scope

- Generating the Web UI client directly (this is handled by CI/separate scripts).
- Implementing the plan approval logic itself, which already exists.
