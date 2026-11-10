# Definition of Done

> Supply a real available-repository picker/list and preserve the existing inline refusal feedback and success navigation.

**Strategy: `direct`** — The form component is the direct seam to test the picker rendering, and the server action logic exposes the existing refusal and success navigation behavior.

This pod cannot run the UI tests because of missing vite plugins; the red bar is CI's to show, running in the `pr-checks` job.

## Done when these pass

- [ ] **FR-2.1: Add Repo button in the UI shows repos from the GitHub App installation that aren't onboarded yet** — expecting a `<select>` or equivalent combobox instead of a text input.
  `apps/web-ui/src/app/onboard/page.acceptance.test.tsx`
- [ ] **FR-2.13: Submitting the onboarding form gives feedback. A refusal keeps the user on the form with the reason.** — verifying that a failed onboarding submission returns the rejection error and retains the user on the page.
  `apps/web-ui/src/app/onboard/page.acceptance.test.tsx`
- [ ] **FR-2.13: On success the user lands on the repository's page** — verifying that a successful submission triggers a redirect to the repository page.
  `apps/web-ui/src/app/onboard/page.acceptance.test.tsx`

## Facets

- [ ] Replace the text input in `OnboardView` with a list/picker of available repositories from the GitHub App installation.
- [ ] Update `OnboardPage` to fetch the available repositories and supply them to `OnboardView`.

## Out of scope

- Setting up new GitHub App installations or modifying the installation flow.
- Modifying the actual onboarding transaction behavior on the backend.
