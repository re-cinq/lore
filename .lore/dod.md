# Definition of Done

> Coverage upserts deterministic nodes and replaces covered-file targets, but ingestCoverageReport unconditionally rewrites records and stamps the baseline. It has no same-commit no-op gate, and no test establishes that required condition.

**Strategy: `direct`** — The seam already exists at `ingestCoverageReport`. The acceptance test calls it with the same commit and asserts no writes are performed. The red bar is CI's to show (`ci / dgraph` job runs the live Dgraph tests).

## Done when these pass

- [ ] **performs no writes at the same commit, but a new commit replaces targets without duplicates** — ensures reposting the same report at the same commit is a complete no-op (zero mutations), while maintaining correct replacement behavior on a new commit.
  `libs/shared/src/work/spec-trace/ingest-coverage.acceptance.test.ts`

## Facets

- [ ] Wrap `dgraphClient` mutations to verify `ingestCoverageReport` issues no writes for a same-commit repost.
- [ ] Add same-commit short-circuit in `ingestCoverageReport` before stamping baseline and restamping commit.

## Out of scope

- Other ingest report types (like test reports) idempotency.