# Definition of Done

> ADR-051's prose says Accepted on 2026-10-09, but its machine-readable frontmatter still says status: draft. The requested accepted record is inconsistent, and the manual prototype evidence is not established by that prose.

**Strategy: `mechanical`** — The ticket is a small, fully-specified doc correction that changes no code. The red bar is CI's to show and the CI job `PR Checks / shared` runs the tests.

## Done when these pass

- [ ] **No new permanent tests are owed** — the diff itself is the proof. Existing tests for doc-status parsing must stay green.
  `libs/shared/src/domain/spec-status.test.ts`
- [ ] **Utopia doc-status tests must stay green**
  `libs/shared/src/domain/utopia/docs/doc-status.test.ts`

## Facets

- [x] Change `status: draft` to `status: accepted` in the frontmatter of ADR-051.
- [x] Add `demo_date: 2026-10-09` to the frontmatter of ADR-051.

## Out of scope

- Changes to code or behavior.
