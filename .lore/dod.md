# Definition of Done

> The new Triage page needs to be accessible from the repository layout navigation alongside existing tabs.

**Strategy: `direct`** — A direct layout component test can render RepoLayout today and fail because the Triage tab is absent from the navigation.

## Done when these pass

- [x] **renders Triage tab alongside Backlog** — Asserts that "Triage" appears in the tab list alongside "Backlog".
  `apps/web-ui/src/app/repos/[owner]/[repo]/layout.test.tsx`

## Facets

- [x] Add the Triage tab to `repoTabs` in `layout.tsx`.

## Out of scope

- Implementing the Triage page itself (`triage/page.tsx`).
