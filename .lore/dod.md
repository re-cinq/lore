# Definition of Done

> (Optional, incremental) add a tree-sitter grammar (e.g. Rust) + test symbol extraction; confirm the sliding-window fallback still yields file+line chunks for an un-grammared language.

**Strategy: `direct`** — `chunkFile` is an existing, testable seam that takes a language extension and source code. We can assert the symbols extracted for the new grammar directly.

## Done when these pass

- [ ] **extracts symbols using the optional Rust tree-sitter grammar** — chunking `.rs` code returns a chunk with populated `symbol_name` instead of falling back to a file chunk.
  `libs/shared/src/work/chunker-grammar.acceptance.test.ts`

## Facets

- [ ] Add the Rust tree-sitter grammar mapping (`.rs` to `tree-sitter-rust.wasm`) to `EXT_TO_GRAMMAR`.
- [ ] Add the Rust `tree-sitter-rust.wasm` binary and dependencies to the project if required.
- [ ] Ensure existing unsupported language tests continue to pass with the sliding window fallback.

## Out of scope

- Extracting Rust macros or symbols not supported by the default `tree-sitter-rust` node parsing implementation for chunking.
