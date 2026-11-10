# Definition of Done

> the repo setup form still throws away an onboarding refusal and redirects without feedback.

**Strategy: `direct`** — The setup forms currently use a button with an `onClick` action instead of a proper `<form>`. We can test the components directly to ensure they render as forms, use the shared pending state, and display errors.

## Done when these pass

- [x] **surfaces setup-form refusal errors and uses the shared pending-state submit button (ReonboardButton)** — Ensures the reonboard action handles and displays refusal errors through standard form behavior.
  `apps/web-ui/src/components/setup-form.acceptance.test.tsx`
- [x] **surfaces setup-form refusal errors and uses the shared pending-state submit button (SetupWebhookButton)** — Ensures the webhook setup action handles and displays refusal errors through standard form behavior.
  `apps/web-ui/src/components/setup-form.acceptance.test.tsx`

## Facets

- [x] Change `ReonboardButton` and `SetupWebhookButton` to use standard `<form>` elements with `<SubmitButton>` and `useState`-managed pending/error state.
- [ ] Update `reonboard` and `setupWebhook` in `actions.ts` to return action states containing `{ error?: string }`.
- [ ] Pass the updated actions from the page layers to the components.

## Out of scope

- Redesigning the layout of the setup forms.
- Changing `AgentForm.tsx` (it already acts as an active mutation form compliant with FR-4.4).
