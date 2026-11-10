# Definition of Done

> The requested/current spec's getChangedFiles entry point is absent; its naming contract should not be silently assumed satisfied by a different method.

**Strategy: `direct`** — The `PlatformGitHub` adapter exists and serves as the explicit seam where `getChangedFiles` belongs.

## Done when these pass

- [ ] **returns the PR's paginated file list** — validates that `getChangedFiles` correctly fetches the paginated file list of a PR.
  `libs/shared/src/outbound/project/lib/platform-github-get-changed-files.acceptance.test.ts`

## Facets

- [x] Add `getChangedFiles` to `PlatformGitHub` and `GitHubPort` pointing to the paginated file list logic.
- [ ] Remove or migrate internal usage of `listFiles` in `blocked-reason` if necessary.

## Out of scope

- Reimplementing the pagination logic (we can just alias or reuse `listFiles` underlying implementation).
