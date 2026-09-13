# Definition of Done

> updating the ORG definition emitted its (name, NULL) catalog event and
> re-rendered the BARE CR pair — but the project-qualified pair
> (`pr-ready--r2263bc7a`), whose resolution INHERITS the org prompt (the project
> row carries no prompt of its own), kept the old prompt baked in from its last
> render. Dispatches for the repo use the qualified name, so the fleet kept
> running the old recipe after the org save looked fully applied.

**Strategy: `direct`** — the serve entry point already exists:
`handleCatalogEvents` (the core the `GET /api/cluster-agents/{id}/catalog-events`
route calls) is tested with the repo's own in-memory behavioral-spec doubles
(`InMemoryCatalogEvents`, `InMemoryClusterAgents`). The missing behaviour — an
org-level event fanning out to the project rows that inherit it — is absent from
what the tail serves, so the test can call the real handler today and fail on
that absence. No live Postgres is needed (and none is reachable here; the
`src/integration-tests/**` end-to-end is excluded from the default vitest run).

## Done when these pass

- [ ] **an org-level upsert fans out to the project-qualified CRs that inherit
  it** — an acked cluster-agent polling after a single `(name, NULL)` org
  upsert event is served the project-qualified `(name, projectId)` entry too,
  resolved to the inherited definition, so its CR is re-rendered.
  `apps/lore-api/src/transport/routes/cluster-agents/catalog-events.test.ts`

## Facets

- [ ] Fan-out is absent today: the served tail carries only the bare
  `(name, NULL)` entry after an org save.
- [ ] Fix direction (either satisfies the test): the change log fans out an
  org-level event to every project row of that name (serve-time expansion in
  `CatalogEventsRepository` / its `InMemoryCatalogEvents` behavioral spell,
  mirrored in `PgCatalogEvents`), OR `updateOrgDefinition` emits companion
  `(name, projectId)` events at write time in the same statement
  (`UPDATE_ORG_DEF_SQL`). Keep the Pg adapter and the InMemory double at parity.
- [ ] The real-Postgres end-to-end (`apps/lore-api/src/integration-tests/catalog-events.test.ts`)
  should gain the same assertion when the fix lands — it is CI-only (needs a DB,
  excluded from the default run) so it is not the runnable red bar here.

## Out of scope

- The `qualifiedStationRef` dispatch path (FR6.2) — already correct; it points
  dispatch at the qualified name. This ticket is purely that the qualified CR's
  CONTENT goes stale after an org save.
- Deletes and per-repo override saves — those already emit their own
  `(name, projectId)` events (FR1.1). Only the org→dependents fan-out is missing.
