# Definition of Done

> Extend the implementation/feature generation prompt templates in `libs/shared/src/agent-defaults/` to emit all three provenance forms; document the format in the prompt. (Prompt-template change; verified by a render/snapshot test.)

**Strategy: `mechanical`** — The ticket dictates a text edit to prompt templates and a unit test that pins source text (the prompt strings). Since testing source text is forbidden for acceptance tests, this is a mechanical change verified by diff and string-matching tests.

## Done when these pass

- [x] **agent-defaults-content.test.ts** — The existing string-matching tests for prompt templates and the new test verifying the provenance instructions.
  `libs/shared/src/outbound/project/agents/agent-defaults-content.test.ts`

## Facets

- [x] Add instructions for the `// lore:validates` annotation and `Lore-Validates:` commit trailer to `libs/shared/src/agent-defaults/loop-tdd-round.md` (and any other implementation prompt templates if required).
- [x] Add a unit test to `libs/shared/src/outbound/project/agents/agent-defaults-content.test.ts` asserting the prompt(s) contain the required three provenance forms.

## Out of scope

- Wiring ingestion of the new provenance forms or consuming them in production.
