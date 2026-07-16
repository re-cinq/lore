# Feature Specification: Test-Run ↔ Statement Binding

| Field          | Value                                                                                   |
|----------------|-----------------------------------------------------------------------------------------|
| Feature        | Test-Run ↔ Statement Binding                                                             |
| Status         | Shipped                                                                                    |
| Created        | 2026-06-11                                                                               |
| Owner          | Platform Engineering                                                                     |
| Decision       | [ADR-023](../../adrs/ADR-023-test-run-trace-binding.md) — derive descriptor spec anchors from inline spec links |
| Consumes       | [`spec-test-coverage`](../spec-test-coverage/spec.md) — the inline `([validated by](test.ts#Lnn))` links |
| Feeds          | [`spec-traceability-graph`](../spec-traceability-graph/spec.md) — `ingestTestReport`'s anchor path (`Statement.validated_by` / `violated`) |

## Problem Statement

The deterministic test-report pipeline is built and live: on every push to
`main`, [`lore-tests.yml`](../../.github/workflows/lore-tests.yml) runs the
test-interface and POSTs ~2.4k `{commit, branch, tests, results}` to
`/api/repos/:o/:r/test-report`, which the agent projects into the graph via
[`ingestTestReport`](../../libs/shared/src/spec-trace/ingest-test-report.ts).

But that projection writes a `Statement.validated_by` / `Statement.violated`
edge **only** when a `TestDescriptor` carries a `spec` anchor (`path#ordinal`)
or its describe-chain *sentence-matches* a statement's text. The producer
([`descriptorsFromVitestList`](../../libs/shared/src/spec-trace/trace-descriptors.ts))
emits **no `spec` anchor**, and conventional `describe("functionName", …)`
tests do not sentence-match statement prose. So the run side knows every test's
pass/fail but never attaches it to the statement — the **`violated` signal, the
single highest-value thing the coupling source ranks on, is structurally
starved.**

Meanwhile the *spec* side already encodes the link: each statement carries an
inline `([validated by `name`](path/to/test.ts#L42))` parenthetical that
[`projectSpecFile`](../../libs/shared/src/spec-trace/project-spec-file.ts) turns into
a `VALIDATED_BY` edge. The two halves never meet: the static link says *which*
test should validate a statement; the dynamic run knows *whether it passed* —
but nothing joins them.

## Solution

A pure inverter, `bindDescriptorsToSpecLinks`, over a repo's spec markdown plus
its parsed `TestDescriptor`s. It reuses
[`linksForStatements`](../../libs/shared/src/spec-link-parser.ts) to read every
statement's inline test links, indexes them by `(test path, line)`, and stamps
`descriptor.spec = `${specPath}#${ordinal}`` on each descriptor whose file
matches a link's path and whose `[startLine, endLine]` span contains the link's
line. The producer (`list-tests.mjs`) calls it after segmentation, so anchored
descriptors arrive at `/test-report` and `ingestTestReport`'s existing anchor
path fires deterministically — `validated_by` on every run, `violated` whenever
that exact linked test fails. Zero LLM, zero new graph code.

**Producer constraint (discovered live).** The inline links are line-precise
(646/646 carry `#Lline`), but `vitest list --json` emits only `{name, file}` —
descriptors are **line-blind**, so the binder has nothing to match a link's line
against and binds nothing on real data. The binding therefore depends on a
deterministic **per-`it` line resolver**: parse each test file, locate the
`it`/`test` declaration matching a descriptor's leaf name, and attach its
`[startLine, endLine]` span. Only then can the line-precise links bind. The
resolver is the prerequisite increment; the binder above is correct but inert
without it.

A second, smaller cut closes the observability hole: the agent's spec-trace
trigger discards `ingestTestReport`'s result counts and the HTTP endpoint
returns a naive guess. The real `{validatedBy, violated, coverageNodes}` is
logged/audited so a run's true graph effect is visible.

## Acceptance Criteria

### Line resolution (the prerequisite)

Each descriptor is stamped with the `[startLine, endLine]` of the `it`/`test`
declaration whose string matches its leaf name; a declaration's span runs to the
next declaration's line minus one, or end of file for the last.
([validated by `resolve-test-lines.test.ts:30`](libs/shared/src/spec-trace/resolve-test-lines.test.ts#L30))

`it.skip` / `it.only` and other modifiers resolve, and the final test's span
runs to end of file.
([validated by `resolve-test-lines.test.ts:40`](libs/shared/src/spec-trace/resolve-test-lines.test.ts#L40))

A descriptor whose leaf name matches no declaration is returned unchanged
(line-blind), so the binder skips it.
([validated by `leaves a descriptor whose leaf name matches no declaration unchanged`](libs/shared/src/spec-trace/resolve-test-lines.test.ts#L40), [validated by `resolve-test-lines:47`](libs/shared/src/spec-trace/resolve-test-lines.test.ts#L47))

### Producer (descriptors from the runner list)

`descriptorsFromVitestList` turns one vitest list entry into a per-`it`
descriptor carrying `id`, `name`, `file`, and the enclosing describe chain as its
`suite` (omitted for a top-level `it`); it drops a stale `dist/` path that is not
under `<pkg>/src/`, keeps two `it`s in the same file as two distinct descriptors,
and groups descriptor ids by file in first-appearance order.
([validated by `trace-descriptors:8`](libs/shared/src/spec-trace/trace-descriptors.test.ts#L8), [validated by `trace-descriptors:29`](libs/shared/src/spec-trace/trace-descriptors.test.ts#L29), [validated by `trace-descriptors:42`](libs/shared/src/spec-trace/trace-descriptors.test.ts#L42), [validated by `trace-descriptors:51`](libs/shared/src/spec-trace/trace-descriptors.test.ts#L51), [validated by `trace-descriptors:68`](libs/shared/src/spec-trace/trace-descriptors.test.ts#L68))

### Binding (the inverter)

A descriptor whose `file` matches an inline test link's path and whose
`[startLine, endLine]` span contains the link's line is stamped with that
statement's anchor, `specPath#ordinal`.
([validated by `bind-descriptors-to-spec-links.test.ts:36`](libs/shared/src/spec-trace/bind-descriptors-to-spec-links.test.ts#L36))

A descriptor that matches **no** inline test link is returned unchanged, with
no `spec` anchor.
([validated by `bind-descriptors-to-spec-links.test.ts:42`](libs/shared/src/spec-trace/bind-descriptors-to-spec-links.test.ts#L42))

A descriptor that already carries a `spec` anchor is left untouched — a
hand-authored anchor wins over a derived one.
([validated by `bind-descriptors-to-spec-links.test.ts:51`](libs/shared/src/spec-trace/bind-descriptors-to-spec-links.test.ts#L51))

A descriptor with no `startLine`/`endLine` is returned unchanged, since line
containment cannot be evaluated.
([validated by `bind-descriptors-to-spec-links.test.ts:60`](libs/shared/src/spec-trace/bind-descriptors-to-spec-links.test.ts#L60))

When a descriptor's span contains links resolving to **more than one** distinct
statement, it is stamped with **all** of them as a `string[]`, so one test
validating several statements links them all.
([validated by `bind-descriptors-to-spec-links.test.ts:69`](libs/shared/src/spec-trace/bind-descriptors-to-spec-links.test.ts#L69))

A descriptor's `spec` — one anchor (string), several (`string[]`), or none — is
parsed into a list of `{specPath, ordinal}`, dropping any entry that does not
parse.
([validated by `spec-anchor.test.ts:28`](libs/shared/src/spec-trace/spec-anchor.test.ts#L28), [validated by `spec-anchor:5`](libs/shared/src/spec-trace/spec-anchor.test.ts#L5), [validated by `spec-anchor:12`](libs/shared/src/spec-trace/spec-anchor.test.ts#L12), [validated by `spec-anchor:16`](libs/shared/src/spec-trace/spec-anchor.test.ts#L16), [validated by `spec-anchor:22`](libs/shared/src/spec-trace/spec-anchor.test.ts#L22), [validated by `spec-anchor:37`](libs/shared/src/spec-trace/spec-anchor.test.ts#L37))

Link paths and descriptor files are compared after normalizing a leading `./`
or `/`, so repo-root-relative and dot-relative forms match.
([validated by `bind-descriptors-to-spec-links.test.ts:81`](libs/shared/src/spec-trace/bind-descriptors-to-spec-links.test.ts#L81), [validated by `bind-descriptors-to-spec-links:107`](libs/shared/src/spec-trace/bind-descriptors-to-spec-links.test.ts#L107))

A link with no `#Lline` anchor seeds no `(path, line)` index entry and binds
nothing.
([validated by `bind-descriptors-to-spec-links.test.ts:90`](libs/shared/src/spec-trace/bind-descriptors-to-spec-links.test.ts#L90), [validated by `bind-descriptors-to-spec-links:122`](libs/shared/src/spec-trace/bind-descriptors-to-spec-links.test.ts#L122))

### Observability

`ingestSpecTrace` returns the real `{validatedBy, violated, coverageNodes,
coversEdges}`, and the agent's spec-trace trigger surfaces it as a one-line log
plus a `spec_trace_ingest` audit row per ingest — replacing the fire-and-forget
discard — so a run's real graph effect is observable.
([validated by `spec-trace-audit.test.ts:33`](apps/floor/src/jobs/spec-trace/spec-trace-audit.test.ts#L33), [validated by `spec-trace-audit:50`](apps/floor/src/jobs/spec-trace/spec-trace-audit.test.ts#L50), [validated by `spec-trace-audit:58`](apps/floor/src/jobs/spec-trace/spec-trace-audit.test.ts#L58), [validated by `spec-trace-audit:74`](apps/floor/src/jobs/spec-trace/spec-trace-audit.test.ts#L74))

## Out of Scope

- The sentence-resolution path (`groupStatementsBySentence`) — unchanged; it
  remains the fallback for describe-chains that mirror statement prose.
- The `drifted` signal (link points at moved code) — owned by the drift-check
  path, not this binding.
- Re-emitting descriptors for non-platform repos: onboarded repos inline their
  own list/run via `LORE_TESTS_INSTRUCTION`; teaching that template to derive
  anchors is a follow-up.
