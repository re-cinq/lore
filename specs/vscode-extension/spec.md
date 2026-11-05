# Feature Specification: VS Code Extension

| Field   | Value                    |
|---------|--------------------------|
| Feature | VS Code Extension        |
| Status  | In Progress              |
| Owner   | Platform Engineering     |

The VS Code Extension surfaces Lore's spec-to-code-to-test links, coverage, and drift inline in the editor by reading the live traceability graph, so a developer sees which spec statements a file implements or validates without leaving the editor.

## Problem Statement

The Lore spec-traceability graph and coverage signal are most useful while a
developer is editing code — but they live in the web UI and the CLI. A VS Code
extension surfaces spec↔code↔test links, coverage, and drift inline in the
editor, reading the live graph so the developer sees which spec statements a
file implements or validates without leaving the editor.

## Functional Requirements

<!--
  One statement per behaviour the extension guarantees; link its unit tests
  inline (v3): `Statement. ([validated by `file.test.ts:NN`](path#LNN))`.
  Group several tests of one behaviour under one statement.
-->

`parseRangesFacet` parses a coverage-range facet string into `{startLine, endLine}` intervals: one interval per comma-separated range, a single-line interval for a bare number, whitespace around ranges and bounds trimmed, non-numeric garbage segments skipped, and an empty array for an empty or `undefined` input. ([validated by `coverage-ranges.test.ts@b10deecc`](apps/vscode-extension/src/coverage-ranges.test.ts#L5), [validated by `coverage-ranges.test.ts@01c8a970`](apps/vscode-extension/src/coverage-ranges.test.ts#L12), [validated by `coverage-ranges.test.ts@8c745911`](apps/vscode-extension/src/coverage-ranges.test.ts#L16), [validated by `coverage-ranges.test.ts@01a03dd8`](apps/vscode-extension/src/coverage-ranges.test.ts#L23), [validated by `coverage-ranges.test.ts@21d65689`](apps/vscode-extension/src/coverage-ranges.test.ts#L27), [validated by `coverage-ranges.test.ts@8887118d`](apps/vscode-extension/src/coverage-ranges.test.ts#L31), [validated by `coverage-ranges.test.ts@865623d6`](apps/vscode-extension/src/coverage-ranges.test.ts#L38))

`buildLocalIndex` reads a spec's inline links and, keyed by file path, emits `implemented`/`human-linked` range entries: the code target's line for a link's `[code]` artifact, the test target's line for its `validated by` artifact, each carrying the statement text, spec line, and the sibling links as `related` (empty when a statement has only a single test link). ([validated by `spec-index.test.ts@e964618d`](apps/vscode-extension/src/spec-index.test.ts#L24), [validated by `spec-index.test.ts@0f13068b`](apps/vscode-extension/src/spec-index.test.ts#L46), [validated by `spec-index.test.ts@42ec9ebf`](apps/vscode-extension/src/spec-index.test.ts#L64))

`buildCoverageIndex` walks the SpecGraph's `validated_by` then `covers` links and attributes each covered file range (from the File node's range detail) to the statement whose test exercised it, as a `covered`/`execution-verified` entry relating back to that test chunk; a `covers` link whose test was never `validated_by` any statement is ignored, and a covering test node with no `path` yields an empty `related` list. ([validated by `spec-index.test.ts@282a9df7`](apps/vscode-extension/src/spec-index.test.ts#L117), [validated by `spec-index.test.ts@51580c19`](apps/vscode-extension/src/spec-index.test.ts#L141), [validated by `spec-index.test.ts@4bfc9f64`](apps/vscode-extension/src/spec-index.test.ts#L176))

`mergeIndexes` overlays the graph coverage index on the local inline index, dropping a coverage entry when an inline link already covers the same statement and file and keeping a coverage entry that has no inline counterpart. ([validated by `spec-index.test.ts@0a4be6d2`](apps/vscode-extension/src/spec-index.test.ts#L293), [validated by `spec-index.test.ts@e7f539c0`](apps/vscode-extension/src/spec-index.test.ts#L315))

`specLenses` emits one code lens per spec line carrying inline links, splitting that line's links into `tests` and `code` targets, emitting a test-only lens with empty `code`, and nothing for a spec with no inline links. ([validated by `spec-lenses.test.ts@4bfbe503`](apps/vscode-extension/src/spec-lenses.test.ts#L18), [validated by `spec-lenses.test.ts@22196c49`](apps/vscode-extension/src/spec-lenses.test.ts#L22), [validated by `spec-lenses.test.ts@4a839a67`](apps/vscode-extension/src/spec-lenses.test.ts#L38), [validated by `spec-lenses.test.ts@71a4b913`](apps/vscode-extension/src/spec-lenses.test.ts#L52))

`openLocalCommandUri` builds a `command:lore.openLocal?` URI encoding the target as a single-element JSON argument array, URI-encoding spaces and brackets in the path so the URI stays well-formed. ([validated by `command-links.test.ts@d5fc4440`](apps/vscode-extension/src/command-links.test.ts#L5), [validated by `command-links.test.ts@586411a8`](apps/vscode-extension/src/command-links.test.ts#L12))

`renderHoverMarkdown` renders a range entry's hover: the statement text, an `openLocalCommandUri` link to the local spec at the statement line (falling back to line 1 when the statement line is unknown), an `openLocalCommandUri` link to each related artifact at its line, and the evidence label for a covered line. ([validated by `hover.test.ts@35b2afc0`](apps/vscode-extension/src/hover.test.ts#L24), [validated by `hover.test.ts@a874f184`](apps/vscode-extension/src/hover.test.ts#L30), [validated by `hover.test.ts@3c6271d5`](apps/vscode-extension/src/hover.test.ts#L36), [validated by `hover.test.ts@bfb2dccb`](apps/vscode-extension/src/hover.test.ts#L45), [validated by `hover.test.ts@0ac30e67`](apps/vscode-extension/src/hover.test.ts#L56))

`resolveCredentialField` trims a raw config value and falls back to the given value when the raw value is undefined, empty, or whitespace-only; `decorationRange` converts a range entry's 1-based start/end lines into a 0-based range clamped to `[0, lastLine]` with the end never below the clamped start; `entriesForPath` looks up a path in the spec/code index, returning an empty array for a null path or a path missing from the index; `partitionByLayer` splits range entries into `implemented` and `covered` buckets by their `layer`. ([validated by `decoration-math.test.ts@12e50d7e`](apps/vscode-extension/src/decoration-math.test.ts#L25), [validated by `decoration-math.test.ts@2c20c8e8`](apps/vscode-extension/src/decoration-math.test.ts#L31), [validated by `decoration-math.test.ts@be83a670`](apps/vscode-extension/src/decoration-math.test.ts#L35), [validated by `decoration-math.test.ts@203a87db`](apps/vscode-extension/src/decoration-math.test.ts#L39), [validated by `decoration-math.test.ts@7857de44`](apps/vscode-extension/src/decoration-math.test.ts#L45), [validated by `decoration-math.test.ts@8ec60ad3`](apps/vscode-extension/src/decoration-math.test.ts#L52), [validated by `decoration-math.test.ts@0034be22`](apps/vscode-extension/src/decoration-math.test.ts#L59), [validated by `decoration-math.test.ts@df93302b`](apps/vscode-extension/src/decoration-math.test.ts#L66), [validated by `decoration-math.test.ts@aaeb6b35`](apps/vscode-extension/src/decoration-math.test.ts#L75), [validated by `decoration-math.test.ts@e0afcfab`](apps/vscode-extension/src/decoration-math.test.ts#L79), [validated by `decoration-math.test.ts@942ca827`](apps/vscode-extension/src/decoration-math.test.ts#L83), [validated by `decoration-math.test.ts@d5aad82c`](apps/vscode-extension/src/decoration-math.test.ts#L92), [validated by `decoration-math.test.ts@2a2065a6`](apps/vscode-extension/src/decoration-math.test.ts#L102))

`LoreClient`'s GET request returns the parsed JSON body on success, retries a retriable status (408/429/5xx) or a network error up to three times with backoff before succeeding or throwing, and throws immediately without retrying on a non-retriable status. ([validated by `lore-client.test.ts@a1c5b9f2`](apps/vscode-extension/src/lore-client.test.ts#L36), [validated by `lore-client.test.ts@ba927c78`](apps/vscode-extension/src/lore-client.test.ts#L47), [validated by `lore-client.test.ts@4e719948`](apps/vscode-extension/src/lore-client.test.ts#L62), [validated by `lore-client.test.ts@dd584550`](apps/vscode-extension/src/lore-client.test.ts#L82), [validated by `lore-client.test.ts@4c4294f3`](apps/vscode-extension/src/lore-client.test.ts#L101))
