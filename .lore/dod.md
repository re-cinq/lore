# Definition of Done

> Inserting a helper above a documented function silently reassigns that function's doc comment to the helper:

**Strategy: `direct`** — The test invokes the ESLint CLI directly against a fixture containing a stranded doc comment. Note that the red bar is CI's to show; the test runs via the `scripts` CI job which has all dependencies installed.

## Done when these pass

- [ ] **reports a stranded doc comment using lore/no-stranded-doc-comment** — A block doc comment whose next non-blank line is another block doc comment triggers the rule.
  `scripts/eslint-rules/no-stranded-doc-comment.acceptance.test.mjs`

## Facets

- [x] Create the new rule `no-stranded-doc-comment` locally.
- [x] Parse the AST to identify adjacent Block comments.
- [x] Skip the check if the first comment's owner is a type/interface declaration (including exported via `ExportNamedDeclaration`).
- [x] Register the local rule in `eslint.config.mjs` under the `lore` plugin prefix.
- [x] Fix acceptance test invocation for ESLint 10: add `--config eslint.config.mjs` so ESLint finds the config when linting files in `/tmp` (ESLint 10 looks from the file, not CWD).

## Out of scope

- Fixing existing occurrences of stranded doc comments.
