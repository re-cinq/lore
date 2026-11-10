# Definition of Done

> Add the requested REST PATCH boundary regression and verify the actual production comment-update path alongside the mutation tests.

**Strategy: `mechanical`** — The ticket requests a missing unit test for already-implemented behaviour. No production behaviour changes are needed, so no failing acceptance test is owed.

## Done when these pass

- [ ] **PlatformGitHub tests** — the existing tests must stay green when the new boundary test is added.
  `libs/shared/src/outbound/project/lib/platform-github.test.ts`

## Facets

- [x] Add a unit test to `platform-github.test.ts` that mocks `issues.updateComment` and asserts `updateIssueComment` sends the correct owner, repo, comment_id, and body.

## Out of scope

- Production code changes.
