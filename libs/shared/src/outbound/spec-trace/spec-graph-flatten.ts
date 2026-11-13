/** Pure flattening of a spec force-graph Dgraph query result into de-duplicated nodes + links (validated_by/implemented_by/decided_by/covers fan-out). Sibling to the ring projection in spec-graph.ts. */

import type { SpecGraph, SpecGraphLink, SpecGraphNode } from "./spec-graph.js";

// Shared shape: validated_by/implemented_by/decided_by selections are identical for a Statement or an AcceptanceCriterion.
interface OwnerLinks {
  vb?: Array<{
    uid: string;
    "TestChunk.file_path"?: string;
    "TestChunk.test_name"?: string;
    "TestChunk.start_line"?: number;
    "TestChunk.end_line"?: number;
    cov?: Array<{
      covers?: Array<{
        uid: string;
        "File.path"?: string;
        "Coverage.covers|ranges"?: string;
      }>;
    }>;
  }>;
  ib?: Array<{
    uid: string;
    "CodeChunk.file_path"?: string;
    "CodeChunk.start_line"?: number;
  }>;
  db?: Array<{ uid: string; "ADR.file_path"?: string; "ADR.number"?: number }>;
}

export interface GraphResult {
  q?: Array<{
    uid: string;
    "Spec.file_path"?: string;
    feature?: { uid: string; "Feature.path"?: string };
    stmts?: Array<OwnerLinks & { uid: string; "Statement.text"?: string }>;
    acs?: Array<
      OwnerLinks & { uid: string; "AcceptanceCriterion.text"?: string }
    >;
  }>;
  /** Covered TestChunks (listed once in the top-level tests block); the flattener reads coverage from here. */
  tests?: NonNullable<OwnerLinks["vb"]>;
}

// Bundles the mutable node and link accumulators.
interface GraphSink {
  nodes: Map<string, SpecGraphNode>;
  links: SpecGraphLink[];
}

/** Pure: Dgraph query result → de-duplicated nodes + links. */
export function flattenSpecGraph(graph: GraphResult): SpecGraph {
  const sink: GraphSink = {
    nodes: new Map(),
    links: [],
  };

  for (const spec of graph.q ?? []) {
    const specPath = spec["Spec.file_path"] ?? spec.uid;

    sink.nodes.set(spec.uid, {
      id: spec.uid,
      type: "Spec",
      label: specLabel(specPath),
      path: specPath,
    });
    emitFeatureNode(spec, sink);
    emitSpecChildNodes(spec, specPath, sink);
  }
  emitTestCoverage(graph.tests, sink);

  return { nodes: [...sink.nodes.values()], links: sink.links };
}

/** Emits TestChunk → File `covers` edges once per test from the top-level `tests` block, adding unlinked covered TestChunks. */
function emitTestCoverage(tests: GraphResult["tests"], sink: GraphSink): void {
  const covered = (tests ?? []).filter(coversSomething);

  for (const chunk of covered) {
    if (!sink.nodes.has(chunk.uid)) {
      sink.nodes.set(chunk.uid, testChunkNode(chunk));
    }
    emitCoveredFileNodes(chunk, sink);
  }
}

function coversSomething(
  chunk: NonNullable<OwnerLinks["vb"]>[number],
): boolean {
  return (chunk.cov ?? []).some((c) => (c.covers ?? []).length > 0);
}

/** "specs/1-lore-platform/spec.md" → "1-lore-platform (spec)"; ".specify/spec.md" → "spec". */
export function specLabel(path: string): string {
  const rel = path.replace(/^specs\//, "").replace(/^\.specify\//, "");
  const parts = rel.split("/");
  const doc = (parts.pop() ?? rel).replace(/\.md$/, "");
  const dir = parts.join("/");

  return dir ? `${dir} (${doc})` : doc;
}

/** One node per feature folder (deduped by uid); every md file hangs under it via `in_feature`. */
function emitFeatureNode(
  spec: NonNullable<GraphResult["q"]>[number],
  sink: GraphSink,
): void {
  const { feature } = spec;

  if (!feature) {
    return;
  }
  sink.nodes.set(feature.uid, featureNodeFor(feature));
  sink.links.push({
    source: feature.uid,
    target: spec.uid,
    kind: "in_feature",
  });
}

function featureNodeFor(feature: {
  uid: string;
  "Feature.path"?: string;
}): SpecGraphNode {
  const p = feature["Feature.path"] ?? feature.uid;

  return { id: feature.uid, type: "Feature", label: basename(p), path: p };
}

function emitSpecChildNodes(
  spec: NonNullable<GraphResult["q"]>[number],
  specPath: string,
  sink: GraphSink,
): void {
  for (const st of spec.stmts ?? []) {
    emitStatementNode(spec.uid, specPath, st, sink);
  }

  for (const ac of spec.acs ?? []) {
    emitAcceptanceCriterionNode(spec.uid, specPath, ac, sink);
  }
}

function emitStatementNode(
  specUid: string,
  specPath: string,
  st: NonNullable<NonNullable<GraphResult["q"]>[number]["stmts"]>[number],
  sink: GraphSink,
): void {
  sink.nodes.set(st.uid, {
    id: st.uid,
    type: "Statement",
    label: "",
    path: specPath,
    detail: (st["Statement.text"] ?? "").trim(),
  });
  sink.links.push({ source: specUid, target: st.uid, kind: "in_spec" });
  emitOwnerLinks(st.uid, st, sink);
}

function emitAcceptanceCriterionNode(
  specUid: string,
  specPath: string,
  ac: NonNullable<NonNullable<GraphResult["q"]>[number]["acs"]>[number],
  sink: GraphSink,
): void {
  sink.nodes.set(ac.uid, {
    id: ac.uid,
    type: "AcceptanceCriterion",
    label: "",
    path: specPath,
    detail: (ac["AcceptanceCriterion.text"] ?? "").trim(),
  });
  sink.links.push({ source: specUid, target: ac.uid, kind: "in_spec" });
  emitOwnerLinks(ac.uid, ac, sink);
}

// Emits validated_by/implemented_by/decided_by edges (plus covers fan-out) for one owner; caller emits the owner node + its in_spec link.
function emitOwnerLinks(
  ownerUid: string,
  owner: OwnerLinks,
  sink: GraphSink,
): void {
  emitValidatedByLinks(ownerUid, owner.vb, sink);
  emitImplementedByLinks(ownerUid, owner.ib, sink);
  emitDecidedByLinks(ownerUid, owner.db, sink);
}

function emitValidatedByLinks(
  ownerUid: string,
  vb: OwnerLinks["vb"],
  sink: GraphSink,
): void {
  for (const t of vb ?? []) {
    sink.nodes.set(t.uid, testChunkNode(t));
    sink.links.push({ source: ownerUid, target: t.uid, kind: "validated_by" });
  }
}

// implemented_by CodeChunks are aggregated to the same per-path File node for display.
function emitImplementedByLinks(
  ownerUid: string,
  ib: OwnerLinks["ib"],
  sink: GraphSink,
): void {
  for (const c of ib ?? []) {
    const p = c["CodeChunk.file_path"] ?? c.uid;
    const fileId = `file|${p}`;

    ensureFileNode(fileId, p, sink);
    sink.links.push({
      source: ownerUid,
      target: fileId,
      kind: "implemented_by",
    });
  }
}

function ensureFileNode(fileId: string, path: string, sink: GraphSink): void {
  if (!sink.nodes.has(fileId)) {
    sink.nodes.set(fileId, {
      id: fileId,
      type: "File",
      label: basename(path),
      path,
    });
  }
}

function emitDecidedByLinks(
  ownerUid: string,
  db: OwnerLinks["db"],
  sink: GraphSink,
): void {
  for (const a of db ?? []) {
    const p = a["ADR.file_path"] ?? a.uid;

    sink.nodes.set(a.uid, {
      id: a.uid,
      type: "ADR",
      label: adrLabel(p),
      path: p,
    });
    sink.links.push({ source: ownerUid, target: a.uid, kind: "decided_by" });
  }
}

/** The display node for one validating TestChunk; falls back to the uid when the row carries no file path. */
function testChunkNode(
  chunk: NonNullable<OwnerLinks["vb"]>[number],
): SpecGraphNode {
  const path = chunk["TestChunk.file_path"] ?? chunk.uid;

  return {
    id: chunk.uid,
    type: "TestChunk",
    label: basename(path),
    path,
    line: chunk["TestChunk.start_line"],
    endLine: chunk["TestChunk.end_line"],
    detail: chunk["TestChunk.test_name"],
  };
}

// The File this test exercises, reached via Coverage (HAS_COVERAGE → COVERS); one node per path (deduped).
function emitCoveredFileNodes(
  testChunk: NonNullable<OwnerLinks["vb"]>[number],
  sink: GraphSink,
): void {
  for (const f of (testChunk.cov ?? []).flatMap((c) => c.covers ?? [])) {
    const fp = f["File.path"] ?? f.uid;
    const fileId = `file|${fp}`;

    sink.nodes.set(fileId, {
      id: fileId,
      type: "File",
      label: basename(fp),
      path: fp,
      detail: f["Coverage.covers|ranges"],
    });
    sink.links.push({ source: testChunk.uid, target: fileId, kind: "covers" });
  }
}

/** "adrs/ADR-016-dark-factory.md" → "ADR-016 (dark-factory)". */
export function adrLabel(path: string): string {
  const base = basename(path).replace(/\.md$/, "");
  const m = base.match(/^(ADR-\d+)-(.*)$/i);

  return m ? `${m[1]} (${m[2]})` : base;
}

function basename(path: string): string {
  return path.split("/").pop() ?? path;
}
