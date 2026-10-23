# Definition of Done

> Append CI verdicts, failed step details, and previous round reports into the `{prompt}`.

**Strategy: `direct`** — The prompt generation seam exists; we point our tests at an intended `appendRuntimeContext` function that will be added to the target file. The red bar is CI's to show (the `lore-tests.yml` or vitest check runs the tests).

## Done when these pass

- [ ] **appends it to the prompt as a block of its own, which stays last. tells the next pod to run only a failed step's command when the report names one, and a job's whole command only when it names a bare check.**
  `libs/shared/src/domain/agents/recipe-prompt.acceptance.test.ts`
- [ ] **appends them to the next agent prompt as ## The previous round reported, before the CI verdict, which stays last.**
  `libs/shared/src/domain/agents/recipe-prompt.acceptance.test.ts`
- [ ] **renders only when the visit that routed here reported changes AND the args name a failed check.**
  `libs/shared/src/domain/agents/recipe-prompt.acceptance.test.ts`

## Facets

- [ ] Export `appendRuntimeContext` in `recipe-prompt.ts`
- [ ] Render the previous round report when `previous_round_report` is provided
- [ ] Render the CI verdict and check details when `ci_verdict` and `reported_changes` are provided
- [ ] Format failed steps versus bare jobs appropriately

## Out of scope

- Extracting the job logs (this is done externally before this prompt is built)
- Sending the result to the LLM (this handles prompt construction only)
