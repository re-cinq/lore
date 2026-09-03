# Definition of Done
Strategy: direct
Why: Both seams exist today — `parseAssemblyLine` loads the YAML and `parseTaskTypesFile` reads the recipe, so the acceptance tests can call the real entry points and fail on the missing edge and missing recipe text.
Acceptance tests:
  - libs/assembly-lines/src/implementation-loop-line.test.ts::routes no_new_test from dod to open-pr, so a trivial ticket proceeds to implementation without a red bar — the YAML must carry a `no_new_test` edge from `dod` to `open-pr`
  - libs/shared/src/task-types/task-types-config.test.ts::names no_new_test as a valid outcome for trivial or mechanical tickets — the `acceptance-dod` recipe must contain the string `no_new_test`
Facets (the red-green-refactor steps you expect, smallest first):
  - Add `- from: dod, to: open-pr, on: no_new_test` to `libs/assembly-lines/src/assembly-lines/implementation-loop.yaml`
  - Add `no_new_test` outcome description and `LORE_NODE_RESULT: {"outcome":"no_new_test"}` to the `acceptance-dod` recipe in `scripts/task-types.yaml`, explaining when a ticket is mechanical and no tests are needed
  - Update `tdd-round` recipe to read `Strategy: no-new-test` from `.lore/dod.md` and implement directly without a red bar
Out of scope: changing the routing of `tdd-round success` (it still goes to `ready-for-review`); adding a new node type; changing anything in the `tdd-round` YAML graph; the `pr-ready` and `fix-ci` recipes are untouched.
