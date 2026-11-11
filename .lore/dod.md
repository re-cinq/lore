# Definition of Done

> The per-file action and local-MCP wording requirements are explicitly reconciled with the live UI, or implemented and tested as written.

**Strategy: `mechanical`** — The code and tests already omit per-file PR actions (using the single setup trigger) and append a last-seen suffix when activity is known. The requirement is reconciled by updating the spec to match this tested behavior.

## Done when these pass

- [x] **carries no per-file PR action on a missing github file: the box's one trigger covers every missing file** — pins that per-file actions are omitted
  `apps/web-ui/src/lib/enrollment.test.ts`
- [x] **local MCP passes with a developer count and a last-seen suffix when activity is known** — pins that a known suffix is appended
  `apps/web-ui/src/lib/enrollment.test.ts`
- [x] **local MCP passes without a last-seen suffix when activity is unknown** — pins that unknown omits the suffix
  `apps/web-ui/src/lib/enrollment.test.ts`

## Facets

- [x] Reconcile missing github files behavior in specs/shared-utilities/spec.md
- [x] Reconcile local-mcp behavior in specs/shared-utilities/spec.md

## Out of scope

- Behavioral changes to UI components