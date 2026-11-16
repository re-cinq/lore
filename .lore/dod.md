# Definition of Done

> Run graph and trace response shapes have no declared contract, so web-ui's two hand-copied types cannot be replaced by generated ones.

**Strategy: `direct`** — The API response validation and model schemas expose seams that currently fail to enforce a strict contract.

## Done when these pass

- [x] **declares a strict response schema for the run graph** — Run graph payload fields are strictly typed, failing on invalid structure.
  `apps/lore-api/src/transport/routes/assembly-lines/run-read.acceptance.test.ts`
- [x] **declares strict response schemas for trace shapes** — Trace read responses are strictly typed, rejecting loose or invalid trace structures.
  `apps/lore-api/src/transport/routes/trace/trace.acceptance.test.ts`
- [x] **declares a strict schema for the graph field** — The graph field on AssemblyRun uses a detailed Zod schema rather than z.custom.
  `libs/shared/src/domain/models/assembly-run.acceptance.test.ts`

## Facets

- [x] Define strict Zod schemas for trace-types in libs/shared/src/domain/models/
- [x] Define strict Zod schemas for run-graph in libs/shared/src/domain/models/
- [x] Replace z.custom() with the new RunGraph schema in AssemblyRunSchema
- [x] Update RunReadSchema to use the new RunGraph shapes
- [x] Update TraceReadSchema to use the new Trace shapes

## Out of scope

- Generating the TypeScript types for web-ui
- Refactoring existing assembly line or trace processing logic
