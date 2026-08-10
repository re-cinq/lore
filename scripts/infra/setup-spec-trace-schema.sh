#!/usr/bin/env bash
set -euo pipefail

# Apply the spec-traceability-graph Dgraph DQL schema — the type system +
# predicate/index definitions from specs/spec-traceability-graph/data-model.md —
# to a running Dgraph Alpha. Sibling of scripts/infra/setup-memory-dgraph-schema.sh.
#
# Additive: Dgraph's /alter merges this with the memory schema already present
# in the shared cluster (no data touched, indexes converge to the declared set).
# Idempotent: re-applying the same schema is a no-op.
#
# Targets the Alpha HTTP endpoint (default: local dev on :8081 — see
# compose.yaml). Override for another host/port:  DGRAPH_HTTP=http://host:8080

DGRAPH_HTTP="${DGRAPH_HTTP:-http://localhost:8081}"

log() { echo "[lore] $*"; }
fail() { echo "[lore] ERROR: $*" >&2; exit 1; }

command -v curl >/dev/null 2>&1 || fail "curl not found — needed to apply the Dgraph schema"

# Predicate + index definitions first, then the type system that references them.
SCHEMA=$(cat <<'DQL'
Spec.xid: string @index(hash) @upsert .
Section.xid: string @index(hash) @upsert .
Statement.xid: string @index(hash) @upsert .
CodeChunk.xid: string @index(hash) @upsert .
TestChunk.xid: string @index(hash) @upsert .
Coverage.xid: string @index(hash) @upsert .
AcceptanceCriterion.xid: string @index(hash) @upsert .
Block.xid: string @index(hash) @upsert .
Repo.xid: string @index(hash) @upsert .
ADR.xid: string @index(hash) @upsert .
TestSuite.xid: string @index(hash) @upsert .
File.xid: string @index(hash) @upsert .
Feature.xid: string @index(hash) @upsert .
TraceLink.xid: string @index(hash) @upsert .

TraceLink.repo: string @index(hash) .
TraceLink.statement: uid @reverse .
TraceLink.target: uid @reverse .
TraceLink.kind: string @index(hash) .
TraceLink.evidence: string @index(hash) .
Statement.trace_links: [uid] @reverse @count .
AcceptanceCriterion.trace_links: [uid] @reverse @count .

Repo.name: string @index(hash) .
# The commit whose line numbering every range in this repo's graph is expressed
# in — stamped by the coverage ingest that writes those ranges. Read by the
# pre-merge impact query to align a PR diff to the same coordinate system.
Repo.trace_commit: string @index(hash) .
Repo.trace_commit_at: dateTime @index(hour) .
Repo.specs: [uid] @reverse @count .
Repo.adrs: [uid] @reverse @count .
Repo.code_chunks: [uid] @reverse @count .
Repo.test_chunks: [uid] @reverse @count .
Repo.test_suites: [uid] @reverse @count .
Repo.coverage: [uid] @reverse @count .
Repo.files: [uid] @reverse @count .

Spec.repo: string @index(hash) .
Spec.file_path: string @index(hash) .
Spec.content_hash: string .
Spec.title: string .
Spec.feature: uid @reverse .
Spec.sections: [uid] @reverse @count .
Spec.acceptance_criteria: [uid] @reverse @count .

# Feature: one node per speckit folder under specs/ (xid `${repo}|specs/<name>`).
# Groups a folder's many md files (spec.md, plan.md, data-model.md, …) under one
# UI node; the md Specs point at it via Spec.feature (reverse: ~Spec.feature).
Feature.repo: string @index(hash) .
Feature.path: string @index(hash) .
Feature.title: string .
Section.spec: uid @reverse .
Section.heading: string @index(term) .
Section.level: int .
Section.ordinal: int .
Section.statements: [uid] @reverse @count .

AcceptanceCriterion.repo: string @index(hash) .
AcceptanceCriterion.spec: uid @reverse .
AcceptanceCriterion.ordinal: int @index(int) .
AcceptanceCriterion.label: string .
AcceptanceCriterion.text: string @index(fulltext) .
AcceptanceCriterion.text_hash: string .
AcceptanceCriterion.embedding: float32vector @index(hnsw(metric:"cosine")) .
AcceptanceCriterion.validated_by: [uid] @reverse @count .
AcceptanceCriterion.implemented_by: [uid] @reverse @count .
AcceptanceCriterion.decided_by: [uid] @reverse @count .
AcceptanceCriterion.drifted: bool @index(bool) .
AcceptanceCriterion.drift_reason: string .
AcceptanceCriterion.drift_severity: float .
AcceptanceCriterion.violated: bool @index(bool) .
AcceptanceCriterion.violation_reason: string .

Block.spec: uid @reverse .
Block.repo: string @index(hash) .
Block.file_path: string @index(hash) .
Block.ordinal: int .
Block.kind: string @index(hash) .
Block.text: string .
Block.level: int .

Statement.repo: string @index(hash) .
Statement.spec: uid @reverse .
Statement.section: uid @reverse .
Statement.ordinal: int @index(int) .
Statement.text: string @index(fulltext) .
Statement.text_hash: string .
Statement.kind: string @index(hash) .
Statement.testability: string @index(hash) .
Statement.category: string .
Statement.embedding: float32vector @index(hnsw(metric:"cosine")) .
Statement.validated_by: [uid] @reverse @count .
Statement.implemented_by: [uid] @reverse @count .
Statement.decided_by: [uid] @reverse @count .
Statement.drifted: bool @index(bool) .
Statement.drift_reason: string .
Statement.drift_severity: float .
Statement.violated: bool @index(bool) .
Statement.violation_reason: string .

CodeChunk.repo: string @index(hash) .
CodeChunk.file_path: string @index(hash) .
CodeChunk.symbol_name: string @index(term) .
CodeChunk.start_line: int .
CodeChunk.end_line: int .
CodeChunk.content_hash: string @index(hash) .
CodeChunk.embedding: float32vector @index(hnsw(metric:"cosine")) .

# File: one node per (repo, path) — the coverage-source aggregation target.
# Coverage --covers--> File carries the covered line intervals as a `ranges`
# edge facet (Coverage.covers|ranges = "12-18,30-40"); facets need no schema.
File.repo: string @index(hash) .
File.path: string @index(hash) .

TestChunk.repo: string @index(hash) .
TestChunk.file_path: string @index(hash) .
TestChunk.test_name: string @index(term) .
TestChunk.symbol_name: string @index(term) .
TestChunk.link_label: string .
TestChunk.start_line: int .
TestChunk.end_line: int .
TestChunk.content_hash: string @index(hash) .
TestChunk.embedding: float32vector @index(hnsw(metric:"cosine")) .
TestChunk.coverage: uid @reverse .
TestChunk.suite: uid @reverse .

TestSuite.repo: string @index(hash) .
TestSuite.name: string @index(term) .
TestSuite.file_path: string @index(hash) .
TestSuite.parent: uid @reverse .
TestSuite.spec: uid @reverse .

Coverage.test: uid @reverse .
Coverage.repo: string @index(hash) .
Coverage.tool: string @index(hash) .
Coverage.commit: string @index(hash) .
Coverage.generated_at: dateTime @index(hour) .
Coverage.line_count: int .
Coverage.covers: [uid] @reverse @count .

ADR.repo: string @index(hash) .
ADR.number: int @index(int) .
ADR.title: string @index(term) .
ADR.status: string @index(hash) .
ADR.file_path: string @index(hash) .
ADR.content_hash: string .
ADR.embedding: float32vector @index(hnsw(metric:"cosine")) .
ADR.supersedes: [uid] @reverse @count .

type Repo {
  Repo.xid
  Repo.name
  Repo.trace_commit
  Repo.trace_commit_at
  Repo.specs
  Repo.adrs
  Repo.code_chunks
  Repo.test_chunks
  Repo.test_suites
  Repo.coverage
  Repo.files
}
type Spec {
  Spec.xid
  Spec.repo
  Spec.file_path
  Spec.content_hash
  Spec.title
  Spec.feature
  Spec.sections
  Spec.acceptance_criteria
}
type Feature {
  Feature.xid
  Feature.repo
  Feature.path
  Feature.title
}
type Section {
  Section.xid
  Section.spec
  Section.heading
  Section.level
  Section.ordinal
  Section.statements
}
type AcceptanceCriterion {
  AcceptanceCriterion.xid
  AcceptanceCriterion.repo
  AcceptanceCriterion.spec
  AcceptanceCriterion.ordinal
  AcceptanceCriterion.label
  AcceptanceCriterion.text
  AcceptanceCriterion.text_hash
  AcceptanceCriterion.embedding
  AcceptanceCriterion.validated_by
  AcceptanceCriterion.implemented_by
  AcceptanceCriterion.decided_by
  AcceptanceCriterion.drifted
  AcceptanceCriterion.drift_reason
  AcceptanceCriterion.drift_severity
  AcceptanceCriterion.violated
  AcceptanceCriterion.violation_reason
  AcceptanceCriterion.trace_links
}
type Block {
  Block.xid
  Block.spec
  Block.repo
  Block.file_path
  Block.ordinal
  Block.kind
  Block.text
  Block.level
}
type ADR {
  ADR.xid
  ADR.repo
  ADR.number
  ADR.title
  ADR.status
  ADR.file_path
  ADR.content_hash
  ADR.embedding
  ADR.supersedes
}
type Statement {
  Statement.xid
  Statement.repo
  Statement.spec
  Statement.section
  Statement.ordinal
  Statement.text
  Statement.text_hash
  Statement.kind
  Statement.testability
  Statement.category
  Statement.embedding
  Statement.validated_by
  Statement.implemented_by
  Statement.decided_by
  Statement.drifted
  Statement.drift_reason
  Statement.drift_severity
  Statement.violated
  Statement.violation_reason
  Statement.trace_links
}
type CodeChunk {
  CodeChunk.xid
  CodeChunk.repo
  CodeChunk.file_path
  CodeChunk.symbol_name
  CodeChunk.start_line
  CodeChunk.end_line
  CodeChunk.content_hash
  CodeChunk.embedding
}
type TestChunk {
  TestChunk.xid
  TestChunk.repo
  TestChunk.file_path
  TestChunk.test_name
  TestChunk.symbol_name
  TestChunk.link_label
  TestChunk.start_line
  TestChunk.end_line
  TestChunk.content_hash
  TestChunk.embedding
  TestChunk.coverage
  TestChunk.suite
}
type TestSuite {
  TestSuite.xid
  TestSuite.repo
  TestSuite.name
  TestSuite.file_path
  TestSuite.parent
  TestSuite.spec
}
type Coverage {
  Coverage.xid
  Coverage.test
  Coverage.repo
  Coverage.tool
  Coverage.commit
  Coverage.generated_at
  Coverage.line_count
  Coverage.covers
}
type File {
  File.xid
  File.repo
  File.path
}
type TraceLink {
  TraceLink.xid
  TraceLink.repo
  TraceLink.statement
  TraceLink.target
  TraceLink.kind
  TraceLink.evidence
}
DQL
)

# Concurrent appliers (parallel test suites, parallel CI jobs) make Dgraph
# reject /alter transiently ("Pending transactions found", indexing in
# progress); the apply is idempotent, so retry until the cluster is free.
MAX_ATTEMPTS=10

log "Applying spec-traceability Dgraph schema to ${DGRAPH_HTTP}/alter ..."
ATTEMPT=0
while :; do
  ATTEMPT=$((ATTEMPT + 1))
  RESP="$(curl -sS -X POST "${DGRAPH_HTTP}/alter" --data-binary "$SCHEMA" 2>/dev/null)" \
    || fail "could not reach Dgraph at ${DGRAPH_HTTP} — is it up? ('npm run dgraph:up' or 'npm run services:up')"

  # Dgraph error strings vary in casing across versions — fold before matching.
  RESP_LC="$(printf '%s' "$RESP" | tr '[:upper:]' '[:lower:]')"

  case "$RESP_LC" in
    *'"code":"success"'*)
      log "Dgraph spec-traceability schema applied (idempotent)."
      break
      ;;
    *'pending transactions found'* | *'errindexinginprogress'* | *'indexing in progress'* | *'operation is already running'*)
      [ "$ATTEMPT" -ge "$MAX_ATTEMPTS" ] && fail "Dgraph still busy after ${MAX_ATTEMPTS} attempts: $RESP"
      log "Dgraph busy (attempt ${ATTEMPT}/${MAX_ATTEMPTS}) — retrying in 2s ..."
      sleep 2
      ;;
    *) fail "Dgraph rejected the schema: $RESP" ;;
  esac
done
