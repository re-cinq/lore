# Definition of Done

> Station posts a verdict comment before calling `project.issues.close`

**Strategy: `direct`** — The seam exists: `closeIssueHandle` accepts injected `issues` deps (comment + close), so the test calls the real function with in-memory fakes and observes call order and arguments.

## Done when these pass

- [ ] **posts the verdict comment before closing the issue** — station calls `issues.comment` then `issues.close` in that order
  `apps/stations/src/work/close-issue/close-issue.test.ts`

- [ ] **posts the verdict text on the correct issue and closes it** — comment body equals the verdict need; close targets the correct issue number
  `apps/stations/src/work/close-issue/close-issue.test.ts`

## Facets

- [ ] Create `apps/stations/src/work/close-issue/index.ts` exporting `closeIssueHandle(deps)` and `startCloseIssueStation()`; implement: parse `needs.repo`, `needs.issue_number`, `needs.verdict`; call `deps.issues(repo)` then `comment`, then `close`
- [ ] Create `apps/stations/src/work/close-issue/manifest.ts` declaring the station's event trigger(s)
- [ ] Register `close-issue` in `apps/stations/src/work/registry.ts` (after T004's entry) — the registry test enforces this
- [ ] Wire `startCloseIssueStation()` into `startFloorStations()` in `apps/stations/src/index.ts`

## Out of scope

- Changes to `libs/assembly-lines/src/assembly-line-schema.ts` (station type is declared in the pipeline YAML only)
- The floor pipeline YAML edit (declared in a separate task)
- The `manifest.ts` trigger wiring (purely mechanical; the registry test covers it)
