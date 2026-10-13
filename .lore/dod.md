# Definition of Done

> Add `GET /api/repos/{owner}/{repo}/pulls/{number}/blocked-reason` (answering `{ repo, prNumber, reason, label, detail, since, updatedAt }`, `reason` null when nothing blocks the PR) and `GET /api/repos/{owner}/{repo}/blocked-pulls` (`{ pulls: [that shape] }`, blocked PRs only), both read scope, served from `pipeline.pr_blocked_reasons`.

**Strategy: `direct`** — New API routes can be built and tested directly against a mocked pg pool without modifying existing components. The red bar is CI's to show; the CI job that runs the tests is `test (lore-api)`.

## Done when these pass

- [ ] **answers the PR's blocked reason with reason null when nothing blocks it** — returns 200 with the PR's blocked reason from pipeline.pr_blocked_reasons
  `apps/lore-api/src/transport/routes/blocked-reasons.test.ts`
- [ ] **answers blocked PRs only in the pulls array** — returns 200 with all blocked PRs for the repo from pipeline.pr_blocked_reasons
  `apps/lore-api/src/transport/routes/blocked-reasons.test.ts`

## Facets

- [x] add route for a single PR's blocked reason
- [x] add route for all blocked PRs in a repo
- [x] map reason codes to labels in the API response

## Out of scope

- writing the blocked reasons to the database
- creating the pipeline.pr_blocked_reasons table
- PR comment and audit log logic
- Code Owner review enforcement
