# Definition of Done

> Middleware branches exist, but real GitHub read failures are wrapped by verifyApproval as TwoKeyError(github_api) and therefore become 403. Complete the intended 503 github_api_unavailable behavior through the real verifier path, preserving 403 for actual approval refusals.

**Strategy: `direct`** — The `checkApproval` middleware is a clear seam, allowing an acceptance test to trigger a GitHub failure through the real `verifyApproval` to observe the 503.

## Done when these pass

- [ ] **GitHub API outage yields 503** — A GitHub outage causes `verifyApproval` to fail, yielding a 503 response through the middleware.
  `apps/lore-api/src/transport/routes/two-key.acceptance.test.ts`

## Facets

- [ ] Change `approvalFailure` to return a 503 when the error is a `TwoKeyError` with code `github_api`.

## Out of scope

- Fixing other `TwoKeyError` codes or implementing missing error behavior.