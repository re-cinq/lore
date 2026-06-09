# Feature Specification: Testing Standards

| Field    | Value                          |
|----------|--------------------------------|
| Feature  | Testing Standards              |
| Branch   | improve-web-ui                 |
| Status   | Accepted                       |
| Created  | 2026-05-29                     |
| Owner    | Platform Engineering           |
| Target   | Ongoing convention             |

## Problem Statement

Lore has 44 test files across four subprojects (`shared`, `mcp-server`,
`agent`, `web-ui`) and vitest is already the de-facto runner everywhere — but
the standard was never written down. As a result:

- New code ships test-after (or untested): the `improve-web-ui` branch added a
  PR-status classifier, README markdown helpers, and spec-path validation with
  no tests.
- No single workflow runs the unit suites; only `test-integration.yml`
  (Postgres-backed, mcp-server only) exists, so unit regressions are not gated.
- Conventions live as scattered bullet points in `CLAUDE.md` rather than as a
  first-class, ingestible spec.

This spec codifies the methodology and conventions so they are discoverable by
both humans and the Lore agent. The decision record is `ADR-018`.

## Requirements

1. **Test-first by default** — new behaviour is developed via the TDD
   Red-Green-Refactor cycle.
2. **One runner** — vitest, `globals: true`, node environment.
3. **Attributable CI** — each subproject's suite runs as its own CI job.
4. **Fast unit feedback** — unit suites carry no external dependencies;
   anything needing Postgres is an integration test, isolated.
5. **Behaviour over implementation** — tests describe what code does, survive
   refactors, and read as natural language.

## Methodology — TDD (mandatory for new code)

Per the `tdd-start` skill. The **Three Laws**:

1. Do not write production code unless it is to make a failing test pass.
2. Do not write more of a test than is sufficient to fail (compile errors count).
3. Do not write more production code than is sufficient to pass the current test.

The **Red → Green → Refactor** cycle:

- **Red** — write one failing test; run it; confirm it fails for the expected
  reason. No production code yet.
- **Green** — write the simplest code that passes (hardcoding is fine here);
  confirm the whole suite is green.
- **Refactor** — remove duplication and improve clarity in both production and
  test code without changing behaviour; suite stays green throughout.

Working rules: one test at a time; **commit on green** before refactoring;
**triangulate** (add a second case to force a general solution when the simplest
implementation would hardcode); keep suites sub-second; delete dead tests.

**Exception — characterization / test-after** is allowed only when adding tests
to pre-existing code (e.g. the `improve-web-ui` backfill). Such tests still
follow every convention below.

## Standards

### Naming

Use one of two forms (no `should`):

- Behavioural: `given [context], when [action], then [expected outcome]`
- Unit: `[function] returns [expected] when [input/condition]`

The unit form must read naturally with the `it(...)` call —
`it("returns true when positive number")`. Name tests by the tested data and
the expected outcome, not by implementation detail.

#### Spec-sentence acceptance links (opt-in)

A test that validates a **spec success-criterion / acceptance statement** may
opt into a third form so the spec-traceability runner links it to that statement
automatically — no inline `([validated by])` edit, no anchors. Nest three levels:

```ts
describe("<spec H1 title>", () => {          // matched as a substring of Spec.title
  describe("<verbatim success-criterion sentence>", () => {  // matched against the statement text
    it("<label>", () => { /* asserts */ });
  });
});
```

The link is derived **structurally** from the describe chain (`suite[0]` = spec,
`suite[1]` = sentence), so it never collides with a separator and a plain
two-level unit test (`describe(unit) > it(behavior)`) can never accidentally
link. Rules: use it **only** for acceptance tests — never on pure unit tests;
copy the sentence **verbatim** from the spec (whitespace, casing, and inline
links are normalized away, so a ragged multi-line copy is fine, but the words
must match); the `<label>` still follows the unit/behavioural naming above.

### Assertions

- Prefer `toEqual({...})` / `toMatchObject({...})` over many single-field asserts.
- No redundant `toBeDefined()` before `toMatch()` / `toMatchObject()`.
- Combine exception checks into a single `expect(...).rejects.toThrow(...)`.
- Use optional chaining in assertions: `expect(obj.data?.field)`.

### Placement

- `agent`, `mcp-server`: tests in `src/__tests__/`.
- `shared`, `web-ui`: tests co-located as `*.test.ts` next to the source.

### Structure

- Extract pure functions (no side effects, no JSX) so logic is testable without
  importing IO or component modules. The branch's `validateSpecPath` and
  `readme-markdown` helpers are the pattern.
- Use `vi.fn()` for mocks; for filesystem work use a tmpdir created in
  `beforeEach` and removed in `afterEach`.
- Remove duplicated test structure with `test.each`, `beforeEach`, or helpers.

### What to test

Pure logic — validators, parsers, classifiers, decision functions. Do not write
tests that only exercise a thin wrapper around an external API or the database.

### Integration tests

DB-backed tests live under `mcp-server/src/__tests__/integration/`, run via
`vitest.integration.config.ts`, and are excluded from the default `vitest run`.
They execute in `test-integration.yml` with a Postgres service, never in the
unit matrix.

## CI Contract

A per-subproject matrix (`.github/workflows/test.yml`, `fail-fast: false`) runs
one job per subproject on every PR to `main`:

| Subproject | Install            | Pre-step                              | Test                          |
|------------|--------------------|---------------------------------------|-------------------------------|
| shared     | `npm install`      | —                                     | `npm test -w @re-cinq/lore-shared` |
| mcp-server | `npm install`      | `npm run build -w @re-cinq/lore-shared` | `npm test -w @re-cinq/lore-mcp` |
| agent      | `npm install`      | `npm run build -w @re-cinq/lore-shared` | `npm test -w @re-cinq/lore-agent` |
| web-ui     | `npm install --prefix web-ui` | —                          | `npm test --prefix web-ui`    |

`mcp-server` and `agent` import the compiled `@re-cinq/lore-shared`, so shared is
built first. `web-ui` is not an npm workspace and is installed in place.

## File Changes

- `.github/workflows/test.yml` — the unit-test matrix (new).
- `agent/vitest.config.ts`, `mcp-server/vitest.config.ts` — exclude `dist/**`
  so stale compiled `dist/__tests__` copies are not discovered.
- `web-ui/src/lib/github.test.ts`, `web-ui/src/lib/spec-path.{ts,test.ts}`,
  `web-ui/src/app/repos/[owner]/[repo]/readme-markdown.{ts,test.ts}` — backfill.

## Out of Scope

- Coverage thresholds / coverage gating.
- E2E / browser tests for web-ui.
- Lint and type-check workflows (separate effort).
- Mutation testing.

## Acceptance Criteria

1. New behaviour is added test-first (Red-Green-Refactor); reviewers can see the
   test in the same or a preceding commit.
2. `npm test` is green for all four subprojects on a clean checkout.
3. A PR to `main` shows four independent `test.yml` runs.
4. Test names follow one of the two approved forms; no `should`.
5. DB-dependent tests do not appear in the unit matrix.
