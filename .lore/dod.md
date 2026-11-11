# Definition of Done

> An agent retried after a failed node sees that node's name and own bounded output, including failure classes outside CI verdicts.

**Strategy: `direct`** — The `appendRuntimeContext` function serves as a direct seam to format agent context, allowing us to test that a node's failure details are correctly appended to the base prompt.

## Done when these pass

- [ ] **appends the failing step's name and its own output to the prompt**
  `libs/shared/src/domain/agents/node-retry-feedback.acceptance.test.ts`

## Facets

- [ ] Add `node_failure?: { name: string; output: string }` to `RuntimeContextArgs`.
- [ ] Update `appendRuntimeContext` to not early return if `node_failure` is present.
- [ ] Build and append a block for `node_failure` naming the step and output.

## Out of scope

- Extracting the failure from the floor events is out of scope for this change, only formatting it is covered here.
