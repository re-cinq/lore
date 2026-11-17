# Definition of Done

> Update `| Status |` to `Implemented` in `specs/plan-detail-fast-open/spec.md`.

**Strategy: `mechanical`** — The ticket is a fully-specified edit updating the spec status and linking previously unlinked statements to existing tests. The red bar is CI's to show; tests are run by the `test` jobs in `.github/workflows/pr-checks.yml`.

## Done when these pass

- [x] **apps/lore-api/src/work/assembly-line-station/protocol.test.ts** — reads a plan-run open of plan p1 with its token, and refuses one without a token
  `apps/lore-api/src/work/assembly-line-station/protocol.test.ts`
- [x] **apps/web-ui/src/app/repos/[owner]/[repo]/plans/[id]/PlanDetailSkeleton.test.tsx** — draws the route skeleton from the toolbar and body parts, each hidden from assistive technology
  `apps/web-ui/src/app/repos/[owner]/[repo]/plans/[id]/PlanDetailSkeleton.test.tsx`
- [x] **apps/web-ui/src/app/repos/[owner]/[repo]/plans/[id]/PlanDetailPage.test.tsx** — renders plan p1 for gedaiu from the plan, its story, the access check and two tokens, reading no run, visit or PR
  `apps/web-ui/src/app/repos/[owner]/[repo]/plans/[id]/PlanDetailPage.test.tsx`

## Facets

- [x] Update status to Implemented.
- [x] Link FR10 to protocol.test.ts.
- [x] Link SC-001 to PlanDetailSkeleton.test.tsx.
- [x] Link SC-003 to PlanDetailPage.test.tsx.

## Out of scope

- New behaviour or new test cases.
