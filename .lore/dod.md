# Definition of Done

> `close-obsolete` MUST be implemented as a new service station in `apps/stations/src/`, written with `@re-cinq/floor-station`, that posts a comment with the triage verdict and calls `project.issues.close`.

**Strategy: `direct`** — a seam already exists: `closeIssueHandle` in `apps/stations/src/issue-triage/close-issue/index.ts` accepts injected `issues` deps, so tests can call through the real handler with a fake project client and observe the call order and arguments.

## Done when these pass

- [ ] **posts the verdict comment before closing the issue** — `closeIssueHandle` calls `issues.comment` before `issues.close`, confirmed by the `order` array in the test scene.
  `apps/stations/src/issue-triage/close-issue/close-issue.test.ts`

- [ ] **posts the verdict text on the correct issue and closes it** — `closeIssueHandle` sends the verdict string to the right issue number and calls `issues.close` with the same number.
  `apps/stations/src/issue-triage/close-issue/close-issue.test.ts`

## Facets

- [x] Implement `closeIssueHandle(deps)` in `apps/stations/src/issue-triage/close-issue/index.ts` using `@re-cinq/floor-station`.
- [x] Export `startCloseIssueStation()` and wire it into `apps/stations/src/issue-triage/index.ts`.
- [x] Import `startIssueTriageStations` in `apps/stations/src/index.ts`.
- [x] Add `apps/stations/src/work/close-issue/manifest.ts` for the sweep registry.
- [x] Add spec-validated-by links on FR15 in `specs/issue-triage/spec.md`.

## Out of scope

- The floor pipeline YAML `stations` block declaration (T012).
- Any change to `libs/assembly-lines/src/assembly-line-schema.ts`.
- Registration of the `triage-label` station (T004).
