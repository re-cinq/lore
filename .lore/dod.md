# Definition of Done

> Agent nodes without a matching recipe file in `libs/shared/src/agent-defaults/` fail the 'non-empty prompt' CI assertion in `seed-floor-pipelines.test.ts`. These three files must be present before T008, T009, and T010 add the corresponding YAML agent nodes.

**Strategy: `direct`** — `loadAgentDefaults()` reads the actual `.md` files from `libs/shared/src/agent-defaults/` and returns parsed definitions. Tests call that function and assert on the returned definitions, so each test fails now because the three recipe files are absent and will pass once they are created with the right frontmatter and prompt bodies.

## Done when these pass

- [x] **triage-reproduce, triage-diagnose, and triage-verify exist with non-empty prompts and correct timeout_minutes** — the three recipe definitions are returned by `loadAgentDefaults()`, each with a non-empty `prompt` and the correct `timeout_minutes` (15 for reproduce, 10 for diagnose and verify)
  `libs/assembly-lines/src/triage-agent-recipes.test.ts`

- [x] **each recipe documents every LORE_NODE_RESULT outcome it can emit** — reproduce's prompt contains `success`, `unable-to-reproduce`, `needs-reproduction`, `skipped`; diagnose's contains `success`, `failed`; verify's contains `success`, `obsolete`, `large-issue`, `not-actionable`
  `libs/assembly-lines/src/triage-agent-recipes.test.ts`

## Facets

- [x] Create `libs/shared/src/agent-defaults/triage-reproduce.md` with `model` and `timeout_minutes: 15` in frontmatter; body describes cloning the repo, running steps, and emitting one of the four outcomes
- [x] Create `libs/shared/src/agent-defaults/triage-diagnose.md` with `timeout_minutes: 10` in frontmatter; body describes instrumentation and root-cause tracing, emitting `success` or `failed`
- [x] Create `libs/shared/src/agent-defaults/triage-verify.md` with `timeout_minutes: 10` in frontmatter; body cross-references diagnosis against specs/docs and reuses `feature-decompose` output contract for the large-issue path, emitting one of the four outcomes

## Out of scope

- The `issue-triage.yaml` assembly-line definition (T008–T010)
- Wiring the YAML agent nodes so `prompt-refs.test.ts` references these recipes (T008–T010)
- The `seed-floor-pipelines.test.ts` 'non-empty prompt' assertion (blocked on T008–T010 adding the floor pipeline definitions)
