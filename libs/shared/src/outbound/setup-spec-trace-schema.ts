import type { DgraphClientPort } from "./memory-store.js";

type AlterClient = { alter(op: { schema: string }): Promise<unknown> };

const TRANSIENT_PATTERNS = [
  /pending transactions found/i,
  /errindexinginprogress/i,
  /indexing in progress/i,
  /operation is already running/i,
];

function isTransient(err: unknown): boolean {
  const text = err instanceof Error ? err.message : String(err);
  return TRANSIENT_PATTERNS.some((p) => p.test(text));
}

const SCHEMA = `
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
Repo.trace_commit: string @index(hash) .
Repo.trace_commit_at: dateTime @index(hour) .
Repo.specs: [uid] @reverse @count .
Repo.adrs: [uid] @reverse @count .
Repo.code_chunks: [uid] @reverse @count .
Repo.test_chunks: [uid] @reverse @count .
Repo.test_suites: [uid] @reverse @count .
Repo.coverage: [uid] @reverse @count .
Repo.files: [uid] @reverse @count .
Repo.failures: [uid] @reverse @count .

Overlay.xid: string @index(hash) @upsert .
Overlay.repo: string @index(hash) .
Overlay.branch: string @index(hash) .
Overlay.head_commit: string @index(hash) .
Overlay.written_at: dateTime @index(hour) .
Overlay.code_chunks: [uid] @reverse @count .
Overlay.test_chunks: [uid] @reverse @count .
Overlay.test_suites: [uid] @reverse @count .
Overlay.coverage: [uid] @reverse @count .
Overlay.files: [uid] @reverse @count .

Failure.xid: string @index(hash) @upsert .
Failure.repo: string @index(hash) .
Failure.assembly_run_id: string @index(hash) .
Failure.station_run_id: string @index(hash) .
Failure.node_id: string @index(hash) .
Failure.iteration: int .
Failure.failure_class: string @index(hash) .
Failure.failure_detail: string .
Failure.commit: string @index(hash) .
Failure.occurred_at: dateTime @index(hour) .
Failure.resolved_by_commit: string @index(hash) .
Failure.files: [uid] @reverse @count .
Failure.chunks: [uid] @reverse @count .

Spec.repo: string @index(hash) .
Spec.file_path: string @index(hash) .
Spec.content_hash: string .
Spec.title: string .
Spec.feature: uid @reverse .
Spec.sections: [uid] @reverse @count .
Spec.acceptance_criteria: [uid] @reverse @count .

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
CodeChunk.references: [uid] @reverse @count .
CodeChunk.imports: [uid] @reverse @count .

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
TestChunk.coverage: [uid] @reverse @count .
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
  Repo.failures
}
type Failure {
  Failure.xid
  Failure.repo
  Failure.assembly_run_id
  Failure.station_run_id
  Failure.node_id
  Failure.iteration
  Failure.failure_class
  Failure.failure_detail
  Failure.commit
  Failure.occurred_at
  Failure.resolved_by_commit
  Failure.files
  Failure.chunks
}
type Overlay {
  Overlay.xid
  Overlay.repo
  Overlay.branch
  Overlay.head_commit
  Overlay.written_at
  Overlay.code_chunks
  Overlay.test_chunks
  Overlay.test_suites
  Overlay.coverage
  Overlay.files
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
  CodeChunk.references
  CodeChunk.imports
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
`;

export async function setupSpecTraceSchema(
  client: DgraphClientPort,
): Promise<void> {
  const alter = (client as unknown as AlterClient).alter.bind(
    client as unknown as AlterClient,
  );

  for (let attempt = 1; attempt <= 10; attempt++) {
    try {
      await alter({ schema: SCHEMA });
      return;
    } catch (err) {
      if (attempt >= 10 || !isTransient(err)) throw err;
      await new Promise<void>((resolve) => setTimeout(resolve, 2_000));
    }
  }
}
