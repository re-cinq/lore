# Definition of Done

> `decideTestInterfaceCheck` treats "a manifest is declared" as fully configured: [...] The workflow is only scaffolded together with the manifest. A repo that wrote its manifest by hand (or through `/lore-test-commands`) but never added the workflow is reported as `configured`, and the onboard task leaves it untouched.

**Strategy: `direct`** — `decideTestInterfaceCheck` is a pure exported function in `libs/shared/src/domain/test-command-manifest.ts`; the test calls it directly with no mocks needed.

## Done when these pass

- [x] **scaffolds only the workflow file when the manifest is declared but lore-tests.yml is absent** — `decideTestInterfaceCheck({ manifestFileDeclared: true, workflowFileDeclared: false })` returns `{ status: "scaffold", files: [".github/workflows/lore-tests.yml"] }` instead of `{ status: "configured" }`
  `libs/shared/src/domain/test-command-manifest.test.ts`

## Facets

- [x] Add `workflowFileDeclared: boolean` to the `sources` parameter of `decideTestInterfaceCheck`
- [x] Return `configured` only when BOTH `declared` AND `workflowFileDeclared` are true
- [x] When `declared` is true but `workflowFileDeclared` is false, return `scaffold` with `files: [".github/workflows/lore-tests.yml"]`
- [x] Update existing callers of `decideTestInterfaceCheck` to pass `workflowFileDeclared` (check `apps/floor/src/work/task/` for onboard usage)
- [x] Update the two existing tests at L162 and L171 that currently assert `configured` when only the manifest is present — they must pass `workflowFileDeclared: true` to remain valid, or be updated to reflect the new behavior

## Out of scope

- Detecting whether the workflow file exists in the onboard task itself (the check is gated by the caller passing `workflowFileDeclared`; how the caller discovers that is implementation detail)
- Changing the scaffold content of `lore-tests.yml` (this ticket only concerns when it is scaffolded, not what it contains)
