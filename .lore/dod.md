# Definition of Done

> Amend ADR-045 with the CHANGELOG and release-notes rule

**Strategy: `mechanical`** — The ticket is a fully-specified documentation edit to an ADR and CLAUDE.md, which does not require new acceptance tests.

## Done when these pass

- [x] **Markdown update** — Documentation update to `adrs/ADR-045-npm-package-publishing.md` and `CLAUDE.md` that touches no executable code.
  `N/A`

## Facets

- [x] Add a dated `## Amendment` heading to `adrs/ADR-045-npm-package-publishing.md` specifying the changelog contract and scope.
- [x] Add an entry to `CLAUDE.md` explaining the changelog rule in its own words.

## Out of scope

- Picking the convention (already settled where it first shipped), creating a `CHANGELOG.md` or CI check in any other repo, creating one in this repo, an org-scoped changelog authoring tool, commit-message linting, and every other clause of ADR-045.
