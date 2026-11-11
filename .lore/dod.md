# Definition of Done

> Create Inbox view layout and item list

**Strategy: `direct`** — The `SidebarNav` component already exists and can be tested for the Inbox link. The new `InboxView` component is tested by importing it in a new test file, which fails on module not found because it hasn't been implemented yet. Since the test runner fails locally due to missing build steps (`@vitejs/plugin-react` resolution), the red bar is CI's to show; the `web-ui` CI job (`npm run test:coverage --prefix apps/web-ui`) runs these tests.

## Done when these pass

- [ ] **shows Inbox as the first link of the top group carrying a badge of open items** — verifies that the sidebar navigation includes the Inbox link at the top group and displays the open item count.
  `apps/web-ui/src/app/SidebarNav.acceptance.test.tsx`
- [ ] **renders list ordered by wait time** — ensures the list is populated with inbox items based on API data.
  `apps/web-ui/src/app/inbox/InboxView.acceptance.test.tsx`
- [ ] **filters items by kind chip** — verifies that clicking a kind chip triggers a filter update.
  `apps/web-ui/src/app/inbox/InboxView.acceptance.test.tsx`
- [ ] **states nothing is waiting when empty** — checks for the empty state message.
  `apps/web-ui/src/app/inbox/InboxView.acceptance.test.tsx`
- [ ] **names unavailable sources on the page** — checks that unavailable sources are explicitly listed.
  `apps/web-ui/src/app/inbox/InboxView.acceptance.test.tsx`

## Facets

- [ ] Create the `InboxView` component skeleton to resolve module imports.
- [ ] Wire up `apiFetch` in `InboxView` for data retrieval.
- [ ] Render the list items and handle the empty/unavailable states.
- [ ] Implement filter chips in `InboxView` and map interactions to API queries.
- [ ] Update `navGroups` and `SidebarNav` to render the Inbox link with a badge count.

## Out of scope

- Implementing the backend API routes for the Inbox.
- Handling item actions (e.g., mark as handled, snooze).
- Detailed styling of the individual inbox items beyond the necessary data fields.
