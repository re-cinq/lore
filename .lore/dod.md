# Definition of Done

> Proposed rule: `lore/no-stranded-doc-comment` — Flag a block doc comment
> (`/** … */`) whose next non-blank line is **another** block doc comment.
> "Nothing catches this. Not `tsc`, not eslint, not the tests."

**Blocked — cannot be expressed as acceptance tests in this repo.** The
ticket asks to create an ESLint house rule. This repo no longer owns any
ESLint rule source: commit `445ce013` (#1849, "Consume
@re-cinq/eslint-plugin-re-lint; delete tools/eslint-plugin-lore") extracted
the entire rule catalog into the separate published package
`@re-cinq/eslint-plugin-re-lint` (GitHub `re-cinq/re-lint`, plugin key
`re-lint`), which lore consumes as a pinned npm dependency
(`@re-cinq/eslint-plugin-re-lint@^1.4.1`). The `lore/` plugin prefix the
ticket uses is dead; the current namespace is `re-lint/`.

The rule `no-stranded-doc-comment` does not exist in the installed package
(verified by importing the plugin and enumerating its 39 rule keys). It
would have to be authored, RuleTester-tested, and published from
`re-cinq/re-lint`, and only then pinned + wired at `error` in this repo's
`eslint.config.mjs`. That is exactly the workflow the last new rule
followed — `prefer-design-tokens` (#2037 / commit `8145954a`, "Pin re-lint
^1.4.1, the first build that ships prefer-design-tokens").

Consequences that make a lore-side DoD impossible:

- The rule's behaviour and its acceptance test both belong in
  `re-cinq/re-lint`, not here. No RuleTester tests for house rules live in
  this repo.
- An acceptance test written on this branch that ran
  `re-lint/no-stranded-doc-comment` against a stranded-comment fixture
  would fail with "Definition for rule … was not found" — and no code
  merged into *this* repo could turn it green. Turning it green requires a
  publish from another repository plus a one-line dependency bump, neither
  of which is the rule-authoring work the ticket describes.
- The implementation pod that follows this DoD works on this branch, in
  this repo, and cannot author or publish the external rule.

## What is needed to unblock

Re-file this ticket against `re-cinq/re-lint`, where the rule catalog now
lives. There, the DoD is honest and `direct`: RuleTester cases proving the
rule flags two stacked `/** … */` doc comments that both immediately
precede a declaration node, and does NOT flag the legitimate
documented-interface-above-documented-function pair (the false positive the
ticket calls out). Once published, a trivial follow-up in lore pins the new
version and adds `"re-lint/no-stranded-doc-comment": "error"` to
`eslint.config.mjs`.

## Out of scope

- Adding the rule inline as an ad-hoc flat-config plugin in
  `eslint.config.mjs`: contradicts the org convention that every house rule
  ships through `re-cinq/re-lint` (see #1849), and is production code this
  DoD step must not write anyway.
