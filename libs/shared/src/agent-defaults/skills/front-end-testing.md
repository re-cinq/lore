---
name: front-end-testing
description: Behaviour-driven UI testing with Testing Library (jsdom) or Vitest Browser Mode, whichever the repo has. Use when testing any front-end application, querying the DOM, or simulating user interactions. For React specifics see react-testing.
---

# Front-End Testing

Test what a user sees and does, not how the component is built: "the more your tests resemble the way your software is used, the more confidence they can give you." Use the environment the repo already has and never add the other one. For React specifics load `react-testing`; for factories and public-API rules load `testing`; for the loop itself `tdd-loop`.

## Two equal environments

| | Testing Library (jsdom) | Vitest Browser Mode |
|---|---|---|
| Queries | `screen.getByRole(...)` | `page.getByRole(...)` from `vitest/browser` |
| Placeholder query | `getByPlaceholderText` | `getByPlaceholder` |
| Display value | `getByDisplayValue` | none; `getByRole` plus a value assertion |
| Assertions | `expect(el).toBeInTheDocument()` (jest-dom) | `await expect.element(locator).toBeVisible()`, retried until it passes |
| Absence | `queryBy*` returns null | `await expect.element(locator).not.toBeInTheDocument()` |
| User events | `userEvent.setup()` from `@testing-library/user-event` | `userEvent` from `vitest/browser`, or `locator.click()` / `.fill()` |
| Waiting | `findBy*`, `waitFor` | built into `expect.element` |
| API mocking (MSW) | `setupServer` from `msw/node` | `setupWorker` from `msw/browser` |

`setupServer` in Browser Mode silently does nothing, because the tests run in a real browser.

## Query priority

Choose the query a user or screen reader would use, in this order: `getByRole` with an accessible name, `getByLabelText`, placeholder, `getByText`, display value, `getByAltText`, `getByTitle`, and `getByTestId` only as a last resort. If no accessible query works, the markup has an accessibility problem; prefer semantic HTML (`<button>`) over ARIA on a `div`.

Wrong:

```typescript
container.querySelector(".submit-button");
screen.getByRole("button");
screen.getByText("Welcome, John Doe");
```

Right: role plus accessible name, a regex where whitespace may change.

```typescript
screen.getByRole("button", { name: /submit/i });
screen.getByText(/welcome.*john doe/i);
```

## Assert absence

With Testing Library, `getBy*` throws when missing and `queryBy*` returns null, so absence is `expect(screen.queryByText(/error/i)).not.toBeInTheDocument()`, never a `toThrow` on `getBy*`.

## Drive the UI like a user

Type into labelled fields, click the real button, assert what appears or what the handler received. A test that only checks the button renders passes with a broken `onClick`; a test that sets internal state breaks on every refactor.

```typescript
await user.type(screen.getByLabelText(/email/i), "ada@example.com");
await user.click(screen.getByRole("button", { name: /submit/i }));
expect(onSubmit).toHaveBeenCalledWith({ email: "ada@example.com" });
```

Prefer `userEvent` to `fireEvent`. Create `userEvent.setup()` inside the test, not in `beforeEach`.

## Async

Use the retrying form, never a fixed sleep: `findBy*` for appearance, `waitForElementToBeRemoved` for disappearance, `waitFor` for a condition, `await expect.element(...)` in Browser Mode. In `waitFor`: one assertion, no side effects, and never wrapped around `findBy*`.

## Mock the network, not fetch

Use MSW so one set of handlers serves tests, Storybook and dev. Override per test with `server.use()` / `worker.use()`. Do not mock `fetch` or axios directly.

## Idempotent tests

Every test builds its own state, renders fresh, cleans up what it persists, and uses unique identifiers when tests run in parallel. A test that relies on another test's side effect is flaky the moment order or parallelism changes.

## Factory render helper, not shared variables

Wrong: a `let button` assigned in `beforeEach`. Right: a helper each test calls.

```typescript
const renderForm = (props: Partial<FormProps> = {}) => {
  render(<Form onSubmit={vi.fn()} {...props} />);
  return { submit: screen.getByRole("button", { name: /submit/i }) };
};
```

Cleanup is automatic; do not call `cleanup()`. Build data with the factories from `testing`.

## Browser Mode notes

- ES module namespaces are sealed in a real browser, so `vi.spyOn` on an import fails; pass the dependency as a parameter instead.
- `alert()` and `confirm()` block the browser; stub them with `vi.spyOn(window, "alert")`.
- No `act()` for interactions through locators.

## Attribution

Adapted from the `front-end-testing` skill in [citypaul/.dotfiles](https://github.com/citypaul/.dotfiles/tree/main/claude/.claude/skills/front-end-testing), Copyright (c) 2024 Paul Hammond, MIT licence. Modified by re:cinq: rewritten much shorter as a single file, with one example per rule and a Help section added. Licence text: `THIRD_PARTY_NOTICES.md` in [re-cinq/lore](https://github.com/re-cinq/lore/blob/main/THIRD_PARTY_NOTICES.md).

## Help

<!-- lore-help:begin -->
**Summary.** Test front-end behavior with Testing Library (jsdom) or Vitest Browser Mode, querying and interacting with the DOM as a user does.
**Usage:** `/front-end-testing`
**Use when.** You are testing any front-end application, querying DOM elements or simulating user interactions.
**Related:** `/react-testing`, `/testing`
<!-- lore-help:end -->
