# Definition of Done

> Implement `pack-loader.ts` conforming to the `SeedDeps` port pattern. Read agent folders, process full replacements or additive extensions. For reapplies, merge against existing per-repository variants using `withVariant`. Do not modify agents the pack does not name.

**Strategy: `direct`** — The `packLoader` module is the new entry point for this task. The test directly calls it and fails because the behavior (and the module) is absent.

## Done when these pass

- [ ] **computes agent overlays with extensions and preserves variants** — ensures it applies extensions, replaces prompts, preserves existing per-repo variants, and leaves unnamed agents untouched
  `apps/lore-api/src/work/pack/pack-loader.acceptance.test.ts`

## Facets

- [ ] Create `pack-loader.ts` module returning a `SeedDeps` wrapper
- [ ] Parse pack agent folders to detect replacements and extensions
- [ ] Implement `importPipeline` interception to merge pack definitions into shipped definitions
- [ ] Retrieve and merge existing per-repo variants from the Floor during processing
- [ ] Leave unnamed shipped agents completely unchanged

## Out of scope

- Actually fetching the pack via GitHub (covered in #4703 T004)
- Creating new pack pipelines from scratch