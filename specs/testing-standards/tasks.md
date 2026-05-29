# Tasks: Testing Standards

| Field   | Value      |
|---------|------------|
| Status  | In progress |
| Created | 2026-05-29 |

- [x] T001 Exclude `dist/**` from vitest in `agent/vitest.config.ts`
- [x] T002 Exclude `dist/**` from vitest in `mcp-server/vitest.config.ts`
- [x] T003 Add `.github/workflows/test.yml` — per-subproject matrix, `fail-fast: false`
- [x] T004 Test `computeStatus` + `isGitHubConfigured` in `web-ui/src/lib/github.test.ts`
- [x] T005 Extract `readme-markdown.ts` (resolveUrl, splitBlocks) from ReadmeBox + test
- [x] T006 Extract `spec-path.ts` (validateSpecPath), rewire `addSpec`, + test
- [x] T007 Write `specs/testing-standards/{spec,plan,tasks}.md`
- [ ] T008 Write `adrs/ADR-018-tdd-and-ci-strategy.md`
- [ ] T009 Confirm all four suites green on a clean checkout
