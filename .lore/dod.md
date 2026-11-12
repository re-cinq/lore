# Definition of Done

> Canonical coverage ingress persists Coverage and replaces File/range-facet targets. The ticket's original CodeChunk-overlap matching and unmatched-record logging are absent: unmatched is always zero. Current spec deliberately describes File aggregation. Remaining work: Reconcile the original CodeChunk/unmatched criteria with the newer File/range contract; verify the agreed behavior at production ingress.

**Strategy: `mechanical`** — The code and its tests already implement the agreed File/ranges contract, where `unmatched` is always zero. This ticket corrects the outdated spec documentation.

## Done when these pass

- [x] **upserts one File per covered file with a ranges facet (merging that file's intervals) and links it via COVERS** — verifies that File aggregation is performed, ranges are facetted, and unmatched is zero.
  `libs/shared/src/work/spec-trace/ingest-coverage.test.ts`

## Facets

- [x] Update `spec.md` line 294 to describe `File` and `ranges` instead of `CodeChunk`s and unmatched logging.

## Out of scope

- Reverting the production implementation to `CodeChunk` overlapping.
