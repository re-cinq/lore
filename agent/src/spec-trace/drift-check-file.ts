/**
 * spec-traceability-graph — Phase 4 drift check (file-scoped).
 *
 * Re-ingesting a source file's chunks and reconciling every spec node that
 * traces to that file against the new content:
 *
 *  - T240 content drift — a Statement or AcceptanceCriterion reached via the
 *    direct `implemented_by` edge OR the coverage chain
 *    (`Coverage.covers <- TestChunk.coverage <- Statement.validated_by`) flips
 *    `drifted = true` with reason `code-content-changed (<symbol>)` when the
 *    overlapping chunk's stored `content_hash` no longer matches the new
 *    content; the chunk's stored hash is refreshed and each covering Coverage
 *    node is marked `stale = true`. A chunk seen for the first time (no stored
 *    hash) is baselined, not drifted.
 *  - T241 link rot — a chunk that overlaps no remaining new chunk drifts its
 *    nodes with reason `file-missing` (the file produced no chunks) or
 *    `line-out-of-range` (the lines moved away).
 *  - T243 graded severity — on content drift, each node's `drift_severity` is
 *    set to the cosine distance between the new chunk embedding and the node
 *    embedding. Graceful-degrade: inert (no severity written) whenever either
 *    embedding is absent, so it stays dormant until statement embeddings exist.
 *
 * Consciously deferred: link-rot-vs-content precedence, max severity across
 * chunks, and drift-clearing on realignment.
 */

import type { DgraphClientPort } from "@re-cinq/lore-shared";
import { cosineSimilarity, parseEmbedding } from "@re-cinq/lore-shared";
import { withTxn } from "./dgraph-upsert.js";
import type { DriftedStatement } from "./format-drift-report.js";

export interface NewCodeChunk {
  filePath: string;
  startLine: number;
  endLine: number;
  contentHash: string;
  symbolName?: string;
  embedding?: number[];
}

export interface DriftCheckResult {
  drifted: DriftedStatement[];
  baselined: number;
}

interface GraphStatement {
  uid: string;
  "Statement.xid": string;
  "Statement.text": string;
  "Statement.embedding"?: unknown;
}

interface GraphAcceptanceCriterion {
  uid: string;
  "AcceptanceCriterion.xid": string;
  "AcceptanceCriterion.text": string;
  "AcceptanceCriterion.embedding"?: unknown;
}

type DriftNodeType = "Statement" | "AcceptanceCriterion";

interface AffectedNode {
  uid: string;
  xid: string;
  text: string;
  nodeType: DriftNodeType;
  embedding?: unknown;
}

interface GraphCodeChunk {
  uid: string;
  "CodeChunk.content_hash"?: string;
  "CodeChunk.symbol_name"?: string;
  "CodeChunk.start_line"?: number;
  "CodeChunk.end_line"?: number;
  stmts?: GraphStatement[];
  acStmts?: GraphAcceptanceCriterion[];
  coverageStmts?: Array<{
    uid: string;
    "~TestChunk.coverage"?: Array<{ "~Statement.validated_by"?: GraphStatement[] }>;
  }>;
}

const FILE_CHUNKS_QUERY = `query q($repo: string, $fp: string) {
  chunks(func: eq(CodeChunk.file_path, $fp)) @filter(eq(CodeChunk.repo, $repo)) {
    uid
    CodeChunk.content_hash
    CodeChunk.symbol_name
    CodeChunk.start_line
    CodeChunk.end_line
    stmts: ~Statement.implemented_by { uid Statement.xid Statement.text Statement.embedding }
    acStmts: ~AcceptanceCriterion.implemented_by { uid AcceptanceCriterion.xid AcceptanceCriterion.text AcceptanceCriterion.embedding }
    coverageStmts: ~Coverage.covers { uid ~TestChunk.coverage { ~Statement.validated_by { uid Statement.xid Statement.text Statement.embedding } } }
  }
}`;

function collectAffectedNodes(chunk: GraphCodeChunk): AffectedNode[] {
  const byUid = new Map<string, AffectedNode>();
  const addNode = (node: AffectedNode) => byUid.set(node.uid, node);
  const addStatement = (statement: GraphStatement) =>
    addNode({
      uid: statement.uid,
      xid: statement["Statement.xid"],
      text: statement["Statement.text"],
      nodeType: "Statement",
      embedding: statement["Statement.embedding"],
    });

  for (const statement of chunk.stmts ?? []) addStatement(statement);
  for (const criterion of chunk.acStmts ?? []) {
    addNode({
      uid: criterion.uid,
      xid: criterion["AcceptanceCriterion.xid"],
      text: criterion["AcceptanceCriterion.text"],
      nodeType: "AcceptanceCriterion",
      embedding: criterion["AcceptanceCriterion.embedding"],
    });
  }
  for (const coverage of chunk.coverageStmts ?? []) {
    for (const testChunk of coverage["~TestChunk.coverage"] ?? []) {
      for (const statement of testChunk["~Statement.validated_by"] ?? []) addStatement(statement);
    }
  }
  return [...byUid.values()];
}

/**
 * Statement xid is `${repo}|${specPath}|${ordinal}`; AcceptanceCriterion xid is
 * `${repo}|${specPath}|ac|${ordinal}` (the `ac` marker is dropped).
 */
function nodeRefFromXid(xid: string): { specPath: string; ordinal: number } {
  const parts = xid.split("|");
  const ordinal = Number(parts.at(-1));
  const pathParts = parts.slice(1, -1);
  if (pathParts.at(-1) === "ac") pathParts.pop();
  return { specPath: pathParts.join("|"), ordinal };
}

function rangesOverlap(chunk: GraphCodeChunk, candidate: NewCodeChunk): boolean {
  const start = chunk["CodeChunk.start_line"] ?? 0;
  const end = chunk["CodeChunk.end_line"] ?? 0;
  return candidate.startLine <= end && candidate.endLine >= start;
}

/** Refreshes a CodeChunk's stored content_hash to the newly-ingested value. */
async function updateChunkHash(
  dgraph: DgraphClientPort,
  chunkUid: string,
  contentHash: string,
): Promise<void> {
  await withTxn(dgraph, (txn) =>
    txn.mutate({
      setJson: { uid: chunkUid, "CodeChunk.content_hash": contentHash },
      commitNow: true,
    }),
  );
}

/** Marks one Coverage node stale=true (the code it covers drifted). */
async function markCoverageStale(
  dgraph: DgraphClientPort,
  coverageUid: string,
): Promise<void> {
  await withTxn(dgraph, (txn) =>
    txn.mutate({
      setJson: { uid: coverageUid, "Coverage.stale": true },
      commitNow: true,
    }),
  );
}

/** Flips one Statement or AcceptanceCriterion to drifted=true with the given reason. */
async function applyDrift(
  dgraph: DgraphClientPort,
  nodeUid: string,
  driftReason: string,
  nodeType: DriftNodeType,
): Promise<void> {
  await withTxn(dgraph, (txn) =>
    txn.mutate({
      setJson: {
        uid: nodeUid,
        [`${nodeType}.drifted`]: true,
        [`${nodeType}.drift_reason`]: driftReason,
      },
      commitNow: true,
    }),
  );
}

/** Writes one node's drift_severity (cosine distance from the new chunk embedding). */
async function applySeverity(
  dgraph: DgraphClientPort,
  nodeUid: string,
  nodeType: DriftNodeType,
  severity: number,
): Promise<void> {
  await withTxn(dgraph, (txn) =>
    txn.mutate({
      setJson: { uid: nodeUid, [`${nodeType}.drift_severity`]: severity },
      commitNow: true,
    }),
  );
}

/** Flips every Statement/AcceptanceCriterion affected by a chunk to drifted with the given reason. */
async function driftChunkStatements(
  dgraph: DgraphClientPort,
  chunk: GraphCodeChunk,
  driftReason: string,
  drifted: DriftedStatement[],
  severitySource?: number[],
): Promise<void> {
  for (const node of collectAffectedNodes(chunk)) {
    await applyDrift(dgraph, node.uid, driftReason, node.nodeType);
    if (severitySource) {
      const nodeVector = parseEmbedding(node.embedding);
      if (nodeVector) {
        const severity = 1 - cosineSimilarity(severitySource, nodeVector);
        await applySeverity(dgraph, node.uid, node.nodeType, severity);
      }
    }
    const { specPath, ordinal } = nodeRefFromXid(node.xid);
    drifted.push({ specPath, ordinal, statementText: node.text, reason: driftReason });
  }
}

export async function driftCheckFile(
  repo: string,
  filePath: string,
  newChunks: NewCodeChunk[],
  dgraph: DgraphClientPort,
): Promise<DriftCheckResult> {
  const graphChunks = await withTxn(dgraph, async (txn) => {
    const res = await txn.queryWithVars(FILE_CHUNKS_QUERY, { $repo: repo, $fp: filePath });
    return (res.data?.chunks ?? []) as GraphCodeChunk[];
  });

  let baselined = 0;
  const drifted: DriftedStatement[] = [];
  const linkRotReason = newChunks.length === 0 ? "file-missing" : "line-out-of-range";

  for (const chunk of graphChunks) {
    const replacement = newChunks.find((candidate) => rangesOverlap(chunk, candidate));
    if (!replacement) {
      await driftChunkStatements(dgraph, chunk, linkRotReason, drifted);
      continue;
    }

    const storedHash = chunk["CodeChunk.content_hash"];
    if (storedHash === replacement.contentHash) continue;

    const isFirstSight = storedHash === undefined;
    await updateChunkHash(dgraph, chunk.uid, replacement.contentHash);

    if (isFirstSight) {
      baselined += 1;
      continue;
    }

    for (const coverage of chunk.coverageStmts ?? []) {
      await markCoverageStale(dgraph, coverage.uid);
    }

    const symbol = chunk["CodeChunk.symbol_name"] ?? replacement.symbolName ?? replacement.filePath;
    const driftReason = `code-content-changed (${symbol})`;
    await driftChunkStatements(dgraph, chunk, driftReason, drifted, replacement.embedding);
  }

  return { drifted, baselined };
}
