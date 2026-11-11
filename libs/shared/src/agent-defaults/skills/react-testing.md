---
name: react-testing
description: React testing for components, hooks and forms with @testing-library/react or vitest-browser-react, whichever the repo has. Use when testing React applications. For general UI testing rules see front-end-testing.
---

# React Testing

Queries, events, async waiting, absence assertions and MSW are in `front-end-testing`; factories and public-API rules are in `testing`. This skill adds what is specific to React. Use the library the repo already has (`@testing-library/react` or `vitest-browser-react`) and do not add the other.

## Component with a callback

```tsx
it("submits ada@example.com from the login form", async () => {
  const onSubmit = vi.fn();
  const user = userEvent.setup();
  render(<LoginForm onSubmit={onSubmit} />);

  await user.type(screen.getByLabelText(/email/i), "ada@example.com");
  await user.click(screen.getByRole("button", { name: /submit/i }));

  expect(onSubmit).toHaveBeenCalledWith({ email: "ada@example.com" });
});
```

## Hook

Test a custom hook with `renderHook`, wrapping it in the provider it needs. Updates go through the `act` that the library provides.

```tsx
it("toggles false to true", () => {
  const { result } = renderHook(() => useToggle(false));

  act(() => result.current.toggle());

  expect(result.current.value).toBe(true);
});
```

For a hook that reads context: `renderHook(() => useAuth(), { wrapper: AuthProvider })`.

## Form with validation

```tsx
it("shows name and email errors when submitted empty", async () => {
  const user = userEvent.setup();
  render(<RegistrationForm onSubmit={vi.fn()} />);

  await user.click(screen.getByRole("button", { name: /sign up/i }));

  expect(await screen.findByText(/name is required/i)).toBeInTheDocument();
  expect(screen.getByText(/email is required/i)).toBeInTheDocument();
});
```

## Browser Mode differences

With `vitest-browser-react`, `render()` and `renderHook()` are async and must be awaited; `render` returns a `screen` scoped to the component; assertions are `await expect.element(screen.getByText(...)).toBeVisible()`; interactions are `await screen.getByRole("button").click()`. The returned `act` from `renderHook` is still used for hook updates.

## Notes

- Portals render outside the component root: query the document (`screen` in Testing Library, `page` from `vitest/browser` in Browser Mode).
- Error boundaries: silence the expected `console.error` with a spy restored at the end of the test, and assert on the fallback text.
- React Server Components cannot be rendered in a component test; test the logic they call, or run an end-to-end test. Client components (`'use client'`) test normally.
- Suspense: assert the fallback first, then the resolved content with a `findBy*` or `expect.element`.

## Rules

- `act()` is needed only for hook updates through `renderHook`. Testing Library wraps `render`, `userEvent` and `waitFor` itself, and Browser Mode locators handle timing; wrapping them in `act` is noise.
- Test rendered output, not component state or instance methods.
- No shallow rendering: it hides the integration bugs between parent and child.

## Attribution

Adapted from the `react-testing` skill in [citypaul/.dotfiles](https://github.com/citypaul/.dotfiles/tree/main/claude/.claude/skills/react-testing), Copyright (c) 2024 Paul Hammond, MIT licence. Modified by re:cinq: rewritten much shorter as a single file, with one example per rule and a Help section added. Licence text: `THIRD_PARTY_NOTICES.md` in [re-cinq/lore](https://github.com/re-cinq/lore/blob/main/THIRD_PARTY_NOTICES.md).

## Help

<!-- lore-help:begin -->
**Summary.** Test React components, hooks, context and forms with Testing Library or vitest-browser-react.
**Usage:** `/react-testing`
**Use when.** You are writing tests for a React application and need patterns for components, hooks and forms.
**Related:** `/front-end-testing`, `/testing`
<!-- lore-help:end -->
