# Definition of Done

> In `apps/web-ui`, the repo settings page shows `auto_merge.approver`, links to GitHub's install page for lore-reviewer on that repo, and shows what the save path said is missing when it refused.

**Strategy: `direct`** — The acceptance tests can call the real entry point today and fail on behaviour.

The red bar is CI's to show. The tests are run by the `test-report` job in `lore-tests.yml`.

## Done when these pass

- [x] **renders the auto_merge.approver select prefilled from settings** — The field for selecting the auto merge approver is present on the form.
  `apps/web-ui/src/app/repos/[owner]/[repo]/settings/SettingsView.test.tsx`
- [x] **links to GitHub's install page for lore-reviewer on that repo** — The settings page provides an installation link.
  `apps/web-ui/src/app/repos/[owner]/[repo]/settings/SettingsView.test.tsx`
- [x] **shows what the save path said is missing when it refused** — The save banner displays the error text returned by the server when saving settings.
  `apps/web-ui/src/app/repos/[owner]/[repo]/settings/SaveResultBanner.test.tsx`

## Facets

- [x] SaveResultBanner supports and renders an error string when passed in `state.error`.
- [x] SettingsView renders the `auto_merge.approver` select field.
- [x] SettingsView includes an installation link for `lore-reviewer`.
- [ ] Settings form save action surfaces the server's refusal message in `state.error`.

## Out of scope

- Changes to `lore-api` validating the setting.
- Running the two-key flow or approval PR process.
