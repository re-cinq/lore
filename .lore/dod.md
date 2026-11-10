# Definition of Done

> Creating a plan never hides failure to seed the description or start its first draft.

**Strategy: `direct`** — `createPlanAction` can be executed directly in tests where `fetch` is mocked to return failure responses for seeding or drafting, ensuring the function returns the error rather than proceeding to redirect.

## Done when these pass

- [x] **returns the seed failure and creates nothing else when seeding the plan fails** — the action returns the failure instead of proceeding to redirect
  `apps/web-ui/src/app/repos/[owner]/[repo]/plans/new/actions.acceptance.test.ts`
- [x] **returns the drafting start failure and creates nothing else when starting the draft fails** — the action returns the failure instead of proceeding to redirect
  `apps/web-ui/src/app/repos/[owner]/[repo]/plans/new/actions.acceptance.test.ts`

## Facets

- [x] Change `seedIntent` to return its `ApiResult` instead of `void`
- [x] Check `seedIntent` return value and return error if failed
- [x] Check `startDrafting` return value and return error if failed

## Out of scope

- Reconcile retired linked requirements instead of restoring their paths (part of the issue but resolved via human decision per acceptance criteria)
