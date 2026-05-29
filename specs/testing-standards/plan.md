# Implementation Plan: testing-standards

| Field   | Value      |
|---------|------------|
| Status  | In progress |
| Created | 2026-05-29 |

## Approach

The standards (see spec.md) are mostly already practiced — this effort writes
them down, operationalizes them in CI, and backfills the gap on `improve-web-ui`.

## Steps

1. **Harden discovery** — exclude `dist/**` from vitest in `agent` and
   `mcp-server` so stale compiled `dist/__tests__` copies (which resolve
   `dist/workflows` and fail) are not picked up.
2. **Per-subproject CI** — add `.github/workflows/test.yml`, a `fail-fast: false`
   matrix with one job per subproject. `mcp-server`/`agent` build
   `@re-cinq/lore-shared` first; `web-ui` installs in place (non-workspace).
3. **Backfill the branch** (characterization, test-after exception): extract the
   buried helpers into pure modules (`spec-path.ts`, `readme-markdown.ts`) and
   test them plus the already-exported `github.ts` classifier.
4. **Record the decision** — `ADR-018` (TDD adoption + CI strategy), cross-linked
   to this spec.
5. **Enforce going forward** — new behaviour follows Red-Green-Refactor.

## Risks

- Importing JSX components (`.tsx`) into tests breaks under `jsx: preserve`;
  mitigated by extracting pure logic into `.ts` modules (done for ReadmeBox).
- web-ui is not a workspace; its install/test must be run with `--prefix web-ui`.
