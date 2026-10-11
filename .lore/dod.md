# Definition of Done

> Add `enablePullRequestAutoMerge(prId, mergeMethod)` (GraphQL), `disablePullRequestAutoMerge(prId)` (GraphQL) and `updateIssueComment(commentId, body)` (REST PATCH) to the same port file.

**Strategy: `direct`** — The port class already exists, so we can test the newly added methods directly on `PlatformGitHub`.

## Done when these pass

- [x] **enablePullRequestAutoMerge sends the mutation with the pull request node id and merge method** — verifies that the GraphQL mutation is sent with the correct ID and SQUASH merge method
  `libs/shared/src/outbound/project/lib/platform-github.test.ts`
- [x] **disablePullRequestAutoMerge sends the mutation with the pull request node id** — verifies that the GraphQL mutation is sent with the correct ID
  `libs/shared/src/outbound/project/lib/platform-github.test.ts`

## Facets

- [x] Add `enablePullRequestAutoMerge` and `disablePullRequestAutoMerge` GraphQL mutations.

## Out of scope

- `updateIssueComment` is already implemented via `issues.updateIssueComment(await this.octo(), repo, id, body)` on `PlatformGitHub` and tested elsewhere, so testing it here is excluded.
