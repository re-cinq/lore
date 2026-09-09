/** spec-traceability-graph — Phase 4 drift check (file-scoped): reconciles spec nodes tracing to a re-ingested file against new content (T240 content drift via `implemented_by` hash mismatch, T241 link rot on missing/moved chunks, T243 graded severity via cosine distance); link-rot-vs-content precedence and drift-clearing on realignment are consciously deferred. */

import type { DgraphClientPort } from "../../outbound/spec-trace/deps.js";
import {
  cosineSimilarity,
  parseEmbedding,
} from "../../outbound/spec-trace/deps.js";
import { withTxn } from "../../outbound/spec-trace/dgraph-upsert.js";
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
  }
}`;

interface DriftCheckContext {
  linkRotReason: string;
  drifted: DriftedStatement[];
}

interface DriftCause {
  reason: string;
  severitySource?: number[];
}

export async function driftCheckFile(
  repo: string,
  filePath: string,
  newChunks: NewCodeChunk[],
  dgraph: DgraphClientPort,
): Promise<DriftCheckResult> {
  const graphChunks = await readGraphChunks(dgraph, repo, filePath);
  const ctx = driftContextFor(newChunks);
  let baselined = 0;

  for (const chunk of graphChunks) {
    const replacement = replacementFor(chunk, newChunks);

    if (await processChunkDrift(dgraph, chunk, replacement, ctx)) {
      baselined += 1;
    }
  }

  return { drifted: ctx.drifted, baselined };
}

/** Every CodeChunk the graph holds for this file, with the nodes tracing to it. */
async function readGraphChunks(
  dgraph: DgraphClientPort,
  repo: string,
  filePath: string,
): Promise<GraphCodeChunk[]> {
  return await withTxn(dgraph, async (txn) => {
    const res = await txn.queryWithVars(FILE_CHUNKS_QUERY, {
      $repo: repo,
      $fp: filePath,
    });

    return (res.data.chunks ?? []) as unknown as GraphCodeChunk[];
  });
}

const driftContextFor = (newChunks: NewCodeChunk[]): DriftCheckContext => ({
  linkRotReason: linkRotReasonFor(newChunks),
  drifted: [],
});

const linkRotReasonFor = (newChunks: NewCodeChunk[]): string =>
  newChunks.length === 0 ? "file-missing" : "line-out-of-range";

const replacementFor = (chunk: GraphCodeChunk, newChunks: NewCodeChunk[]) =>
  newChunks.find((candidate) => rangesOverlap(chunk, candidate));

function rangesOverlap(
  chunk: GraphCodeChunk,
  candidate: NewCodeChunk,
): boolean {
  const start = chunk["CodeChunk.start_line"] ?? 0;
  const end = chunk["CodeChunk.end_line"] ?? 0;

  return candidate.startLine <= end && candidate.endLine >= start;
}

/** Reconciles one graph chunk against its (possibly absent) re-ingested replacement; returns whether it was first-sight baselined. */
async function processChunkDrift(
  dgraph: DgraphClientPort,
  chunk: GraphCodeChunk,
  replacement: NewCodeChunk | undefined,
  ctx: DriftCheckContext,
): Promise<boolean> {
  // The chunk's code is GONE: that is link rot, not drift — nothing changed, the target stopped existing.
  if (!replacement) {
    await driftChunkStatements(dgraph, chunk, rot(ctx), ctx.drifted);

    return false;
  }

  return processReplacedChunk(dgraph, chunk, replacement, ctx.drifted);
}

function rot(ctx: DriftCheckContext) {
  return { reason: ctx.linkRotReason };
}

/** Reconciles one graph chunk against the re-ingested chunk that replaced it; returns whether it was first-sight baselined. */
async function processReplacedChunk(
  dgraph: DgraphClientPort,
  chunk: GraphCodeChunk,
  replacement: NewCodeChunk,
  drifted: DriftedStatement[],
): Promise<boolean> {
  const storedHash = chunk["CodeChunk.content_hash"];

  if (storedHash === replacement.contentHash) {
    return false;
  }

  await updateChunkHash(dgraph, chunk.uid, replacement.contentHash);

  // No stored hash means this chunk is being hashed for the FIRST time. Recording it as drift would flag every chunk in the repo the first time the checker sees it.
  if (storedHash === undefined) {
    return true;
  }
  const cause = moved(chunk, replacement);

  await driftChunkStatements(dgraph, chunk, cause, drifted);

  return false;
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

/** The embedding rides along as the SEVERITY source: how far the code moved in vector space decides whether this was a rename or a rewrite, and only the latter is worth putting in front of a human. */
function moved(chunk: GraphCodeChunk, replacement: NewCodeChunk) {
  return {
    reason: `code-content-changed (${driftSymbolLabel(chunk, replacement)})`,
    severitySource: replacement.embedding,
  };
}

const driftSymbolLabel = (
  chunk: GraphCodeChunk,
  replacement: NewCodeChunk,
): string =>
  chunk["CodeChunk.symbol_name"] ??
  replacement.symbolName ??
  replacement.filePath;

/** Flips every Statement/AcceptanceCriterion affected by a chunk to drifted with the given reason. */
async function driftChunkStatements(
  dgraph: DgraphClientPort,
  chunk: GraphCodeChunk,
  { reason: driftReason, severitySource }: DriftCause,
  drifted: DriftedStatement[],
): Promise<void> {
  for (const node of collectAffectedNodes(chunk)) {
    await applyDrift(dgraph, node.uid, driftReason, node.nodeType);
    await applyDriftSeverity(dgraph, node, severitySource);
    drifted.push(driftRecordFor(node, driftReason));
  }
}

/** Every statement and acceptance criterion a chunk implements, deduped by uid. */
function collectAffectedNodes(chunk: GraphCodeChunk): AffectedNode[] {
  const nodes = [
    ...(chunk.stmts ?? []).map(statementNode),
    ...(chunk.acStmts ?? []).map(criterionNode),
  ];

  return [...new Map(nodes.map((node) => [node.uid, node])).values()];
}

const statementNode = (statement: GraphStatement): AffectedNode => ({
  uid: statement.uid,
  xid: statement["Statement.xid"],
  text: statement["Statement.text"],
  nodeType: "Statement",
  embedding: statement["Statement.embedding"],
});

const criterionNode = (criterion: GraphAcceptanceCriterion): AffectedNode => ({
  uid: criterion.uid,
  xid: criterion["AcceptanceCriterion.xid"],
  text: criterion["AcceptanceCriterion.text"],
  nodeType: "AcceptanceCriterion",
  embedding: criterion["AcceptanceCriterion.embedding"],
});

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

async function applyDriftSeverity(
  dgraph: DgraphClientPort,
  node: AffectedNode,
  severitySource: number[] | undefined,
): Promise<void> {
  if (!severitySource) {
    return;
  }
  const nodeVector = parseEmbedding(node.embedding);

  if (!nodeVector) {
    return;
  }
  const severity = 1 - cosineSimilarity(severitySource, nodeVector);

  await applySeverity(dgraph, node.uid, node.nodeType, severity);
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

const driftRecordFor = (
  node: AffectedNode,
  reason: string,
): DriftedStatement => ({
  ...nodeRefFromXid(node.xid),
  statementText: node.text,
  reason,
});

/** Statement xid is `${repo}|${specPath}|${ordinal}`; AcceptanceCriterion xid is `${repo}|${specPath}|ac|${ordinal}` (the `ac` marker is dropped). */
function nodeRefFromXid(xid: string): { specPath: string; ordinal: number } {
  const parts = xid.split("|");
  const ordinal = Number(parts.at(-1));
  const pathParts = parts.slice(1, -1);

  if (pathParts.at(-1) === "ac") {
    pathParts.pop();
  }

  return { specPath: pathParts.join("|"), ordinal };
}
