# Feature Specification: VS Code Extension

| Field   | Value                    |
|---------|--------------------------|
| Feature | VS Code Extension        |
| Status  | Shipped                  |
| Owner   | Platform Engineering     |

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

`parseRangesFacet` parses a coverage-range facet string into `{startLine, endLine}` intervals: one interval per comma-separated range, a single-line interval for a bare number, whitespace around ranges and bounds trimmed, non-numeric garbage segments skipped, and an empty array for an empty or `undefined` input. ([validated by `coverage-ranges.test.ts:5`](apps/vscode-extension/src/coverage-ranges.test.ts#L5), [validated by `coverage-ranges.test.ts:12`](apps/vscode-extension/src/coverage-ranges.test.ts#L12), [validated by `coverage-ranges.test.ts:16`](apps/vscode-extension/src/coverage-ranges.test.ts#L16), [validated by `coverage-ranges.test.ts:23`](apps/vscode-extension/src/coverage-ranges.test.ts#L23), [validated by `coverage-ranges.test.ts:27`](apps/vscode-extension/src/coverage-ranges.test.ts#L27), [validated by `coverage-ranges.test.ts:31`](apps/vscode-extension/src/coverage-ranges.test.ts#L31))

`buildLocalIndex` reads a spec's inline links and, keyed by file path, emits `implemented`/`human-linked` range entries: the code target's line for a link's `[code]` artifact, the test target's line for its `validated by` artifact, each carrying the statement text, spec line, and the sibling links as `related` (empty when a statement has only a single test link). ([validated by `spec-index.test.ts:24`](apps/vscode-extension/src/spec-index.test.ts#L24), [validated by `spec-index.test.ts:46`](apps/vscode-extension/src/spec-index.test.ts#L46), [validated by `spec-index.test.ts:64`](apps/vscode-extension/src/spec-index.test.ts#L64))

`buildCoverageIndex` walks the SpecGraph's `validated_by` then `covers` links and attributes each covered file range (from the File node's range detail) to the statement whose test exercised it, as a `covered`/`execution-verified` entry relating back to that test chunk. ([validated by `spec-index.test.ts:117`](apps/vscode-extension/src/spec-index.test.ts#L117))

`mergeIndexes` overlays the graph coverage index on the local inline index, dropping a coverage entry when an inline link already covers the same statement and file and keeping a coverage entry that has no inline counterpart. ([validated by `spec-index.test.ts:206`](apps/vscode-extension/src/spec-index.test.ts#L206), [validated by `spec-index.test.ts:228`](apps/vscode-extension/src/spec-index.test.ts#L228))

`specLenses` emits one code lens per spec line carrying inline links, splitting that line's links into `tests` and `code` targets, emitting a test-only lens with empty `code`, and nothing for a spec with no inline links. ([validated by `spec-lenses.test.ts:18`](apps/vscode-extension/src/spec-lenses.test.ts#L18), [validated by `spec-lenses.test.ts:22`](apps/vscode-extension/src/spec-lenses.test.ts#L22), [validated by `spec-lenses.test.ts:38`](apps/vscode-extension/src/spec-lenses.test.ts#L38), [validated by `spec-lenses.test.ts:52`](apps/vscode-extension/src/spec-lenses.test.ts#L52))

`openLocalCommandUri` builds a `command:lore.openLocal?` URI encoding the target as a single-element JSON argument array, URI-encoding spaces and brackets in the path so the URI stays well-formed. ([validated by `command-links.test.ts:5`](apps/vscode-extension/src/command-links.test.ts#L5), [validated by `command-links.test.ts:12`](apps/vscode-extension/src/command-links.test.ts#L12))

`renderHoverMarkdown` renders a range entry's hover: the statement text, an `openLocalCommandUri` link to the local spec at the statement line (falling back to line 1 when the statement line is unknown), an `openLocalCommandUri` link to each related artifact at its line, and the evidence label for a covered line. ([validated by `hover.test.ts:24`](apps/vscode-extension/src/hover.test.ts#L24), [validated by `hover.test.ts:30`](apps/vscode-extension/src/hover.test.ts#L30), [validated by `hover.test.ts:36`](apps/vscode-extension/src/hover.test.ts#L36), [validated by `hover.test.ts:45`](apps/vscode-extension/src/hover.test.ts#L45), [validated by `hover.test.ts:56`](apps/vscode-extension/src/hover.test.ts#L56))
