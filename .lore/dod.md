# Definition of Done

> lore-code-trace runs only the first entry of a multi-entry test-commands manifest

**Strategy: `direct`** — The orchestrator's `run()` is callable in tests, allowing an end-to-end verification of the bug. Note: the red bar is CI's to show; `apps/lore-api/Dockerfile` runs the go builds and tests, and there is no Go toolchain in this pod.

## Done when these pass

- [ ] **TestParseManifestAcceptsMultiEntryManifest** — the orchestrator's `run()` processes and reports tests from all workspaces declared in a multi-entry manifest
  `apps/lore-code-trace/manifest.acceptance.test.go`

## Facets

- [ ] Update `parseManifest` to return `[]Manifest` instead of `Manifest`.
- [ ] Update `run()` in `main.go` to iterate over all valid manifest entries.
- [ ] Build a combined report containing tests/results from all entries before posting.

## Out of scope

- Changes to the TypeScript manifest parser (`libs/shared/src/domain/test-command-manifest.ts`), which already correctly parses arrays.
