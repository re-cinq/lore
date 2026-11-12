# Definition of Done

> Fence classification only recognizes column-zero lines beginning with three backticks; tilde/indented fences and longer-fence closing rules are not handled, so valid fenced code is not reliably one code block.

**Strategy: `direct`** — The pure `segmentBlocks` function exists as a seam to test block segmentation directly.

## Done when these pass

- [ ] **keeps a tilde fenced code block as one verbatim code block** — A tilde fenced block is classified as a single code block.
  `libs/shared/src/domain/spec-blocks.acceptance.test.ts`
- [ ] **keeps an indented fenced code block as one verbatim code block** — An indented fenced block is classified as a single code block.
  `libs/shared/src/domain/spec-blocks.acceptance.test.ts`
- [ ] **keeps a code block with longer fence delimiters and internal short fences as one verbatim code block** — A block fenced with more than three backticks is classified as a single code block.
  `libs/shared/src/domain/spec-blocks.acceptance.test.ts`

## Facets

- [ ] Handle tilde fences (`~~~`)
- [ ] Handle indented fences
- [ ] Support matching fence closing length and types for longer fences
- [ ] Maintain lossless round-trip for these new block types

## Out of scope

- Extracting symbols or modifying tree-sitter semantics inside code blocks.
- Analyzing code block contents.
