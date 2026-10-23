# Definition of Done

> Truncation never slices mid-word or mid-sentence, defaulting to nearest prior paragraph boundary.

**Strategy: `direct`** — `truncateText` already exists in `context-assembly-items.ts` and can be tested directly to prove it slices mid-word when the last paragraph boundary is below 50% of the character limit.

## Done when these pass

- [ ] **never slices mid-word or mid-sentence, defaulting to nearest prior paragraph boundary** — ensures truncation prefers a paragraph boundary rather than a hard character slice
  `libs/shared/src/outbound/project/knowledge/context-assembly-truncate.acceptance.test.ts`

## Facets

- [ ] Remove the 50% maxChars threshold that causes `truncateText` to fall back to a hard slice

## Out of scope

- Advanced natural language sentence boundary detection; checking for `\n\n` is sufficient as requested.
