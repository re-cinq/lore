# Definition of Done

> The linked FR5 additionally promises no options for other definitions or a review without PR; upgradeAvailable now renders an upgrade option in those cases, with an explicit test.

**Strategy: `mechanical`** — the ticket is a doc correction to align the "no options" language with the upgrade feature. It owes no new permanent test.

## Done when these pass

- [ ] **renders the trigger-review button for a code-review run with PR 42** — existing test for trigger-review button staying green
  `apps/web-ui/src/app/assembly-runs/[id]/AssemblyRunOptions.test.tsx`
- [ ] **renders no review options for an implementation run** — existing test staying green
  `apps/web-ui/src/app/assembly-runs/[id]/AssemblyRunOptions.test.tsx`
- [ ] **renders no review options for a code-review run without a PR number** — existing test staying green
  `apps/web-ui/src/app/assembly-runs/[id]/AssemblyRunOptions.test.tsx`
- [ ] **renders the assembly line upgrade action when a newer version exists** — existing test for upgrade action staying green
  `apps/web-ui/src/app/assembly-runs/[id]/AssemblyRunOptions.test.tsx`

## Facets

- [x] Change "renders no options" to "renders no review options" in `specs/assembly-line-run-detail/spec.md`.
- [x] Align test case names in `apps/web-ui/src/app/assembly-runs/[id]/AssemblyRunOptions.test.tsx` to match "no review options".

## Out of scope

- Changes to production behavior.
