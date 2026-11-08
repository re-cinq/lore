# Definition of Done

> Other form mappings are implemented and consumed by the settings page, but parseSettingsForm never reads auto_review. The pinned shared-utilities contract still explicitly requires parsing auto_review from yes/no.

**Strategy: `mechanical`** — The `auto_review` switch was moved to the Loops tab, so the settings form no longer writes or overwrites it. Removing `auto_review` parsing from the spec reconciles the contract with the current UI behavior without requiring a new test.

## Done when these pass

- [ ] **settings-form.test.ts** — The existing unit tests for `parseSettingsForm` must stay green after the spec update.
  `apps/web-ui/src/lib/settings-form.test.ts`

## Facets

- [ ] Remove `auto_review from yes/no, ` from the `settings-form` contract in `specs/shared-utilities/spec.md`.

## Out of scope

- Re-implementing the switch on the Settings tab, or altering how the Loops tab manages `auto_review`.
