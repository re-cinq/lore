# Definition of Done

> chunkFile computes sha256 of each chunk's content at its shared return point, and one test checks a single expected digest. The explicitly requested repeated-identical and changed-content comparisons are absent from that test.

**Strategy: `mechanical`** — the ticket is a fully-specified request to add missing test assertions; the behaviour is already present, so the edit is the test itself.

## Done when these pass

- [ ] **chunkFile** — the added stability and change tests stay green.
  `libs/shared/src/work/chunker.test.ts`

## Facets

- [x] add identical-content test to chunker.test.ts
- [x] add changed-content test to chunker.test.ts

## Out of scope

- modifying the chunking or hashing implementation
