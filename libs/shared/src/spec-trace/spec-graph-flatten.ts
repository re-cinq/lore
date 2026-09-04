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
    // TestChunk.coverage is single-cardinality; Coverage.covers is a set of File targets with intervals on the `ranges` facet.
    cov?: {
      covers?: Array<{
        uid: string;
        "File.path"?: string;
        "Coverage.covers|ranges"?: string;
      }>;
    };
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
}

/** "specs/1-lore-platform/spec.md" → "1-lore-platform (spec)"; ".specify/spec.md" → "spec". */
export function specLabel(path: string): string {
  const rel = path.replace(/^specs\//, "").replace(/^\.specify\//, "");
  const parts = rel.split("/");
  const doc = (parts.pop() ?? rel).replace(/\.md$/, "");
  const dir = parts.join("/");

  return dir ? `${dir} (${doc})` : doc;
}

function basename(path: string): string {
  return path.split("/").pop() ?? path;
}

/** "adrs/ADR-016-dark-factory.md" → "ADR-016 (dark-factory)". */
export function adrLabel(path: string): string {
  const base = basename(path).replace(/\.md$/, "");
  const m = base.match(/^(ADR-\d+)-(.*)$/i);

  return m ? `${m[1]} (${m[2]})` : base;
}

function emitValidatedByLinks(
  ownerUid: string,
  vb: OwnerLinks["vb"],
  nodes: Map<string, SpecGraphNode>,
  links: SpecGraphLink[],
): void {
  for (const t of vb ?? []) {
    const p = t["TestChunk.file_path"] ?? t.uid;

    nodes.set(t.uid, {
      id: t.uid,
      type: "TestChunk",
      label: basename(p),
      path: p,
      line: t["TestChunk.start_line"],
      endLine: t["TestChunk.end_line"],
      detail: t["TestChunk.test_name"],
    });
    links.push({ source: ownerUid, target: t.uid, kind: "validated_by" });
    emitCoveredFileNodes(t, nodes, links);
  }
}

// implemented_by CodeChunks are aggregated to the same per-path File node for display.
function emitImplementedByLinks(
  ownerUid: string,
  ib: OwnerLinks["ib"],
  nodes: Map<string, SpecGraphNode>,
  links: SpecGraphLink[],
): void {
  for (const c of ib ?? []) {
    const p = c["CodeChunk.file_path"] ?? c.uid;
    const fileId = `file|${p}`;

    if (!nodes.has(fileId)) {
      nodes.set(fileId, {
        id: fileId,
        type: "File",
        label: basename(p),
        path: p,
      });
    }
    links.push({ source: ownerUid, target: fileId, kind: "implemented_by" });
  }
}

function emitDecidedByLinks(
  ownerUid: string,
  db: OwnerLinks["db"],
  nodes: Map<string, SpecGraphNode>,
  links: SpecGraphLink[],
): void {
  for (const a of db ?? []) {
    const p = a["ADR.file_path"] ?? a.uid;

    nodes.set(a.uid, { id: a.uid, type: "ADR", label: adrLabel(p), path: p });
    links.push({ source: ownerUid, target: a.uid, kind: "decided_by" });
  }
}

// Emits validated_by/implemented_by/decided_by edges (plus covers fan-out) for one owner; caller emits the owner node + its in_spec link.
function emitOwnerLinks(
  ownerUid: string,
  owner: OwnerLinks,
  nodes: Map<string, SpecGraphNode>,
  links: SpecGraphLink[],
): void {
  emitValidatedByLinks(ownerUid, owner.vb, nodes, links);
  emitImplementedByLinks(ownerUid, owner.ib, nodes, links);
  emitDecidedByLinks(ownerUid, owner.db, nodes, links);
}

// The File this test exercises, reached via Coverage (HAS_COVERAGE → COVERS); one node per path (deduped).
function emitCoveredFileNodes(
  testChunk: NonNullable<OwnerLinks["vb"]>[number],
  nodes: Map<string, SpecGraphNode>,
  links: SpecGraphLink[],
): void {
  for (const f of testChunk.cov?.covers ?? []) {
    const fp = f["File.path"] ?? f.uid;
    const fileId = `file|${fp}`;

    nodes.set(fileId, {
      id: fileId,
      type: "File",
      label: basename(fp),
      path: fp,
      detail: f["Coverage.covers|ranges"],
    });
    links.push({ source: testChunk.uid, target: fileId, kind: "covers" });
  }
}

interface GraphSink {
  nodes: Map<string, SpecGraphNode>;
  links: SpecGraphLink[];
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
  emitOwnerLinks(st.uid, st, sink.nodes, sink.links);
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
  emitOwnerLinks(ac.uid, ac, sink.nodes, sink.links);
}

function emitSpecChildNodes(
  spec: NonNullable<GraphResult["q"]>[number],
  specPath: string,
  nodes: Map<string, SpecGraphNode>,
  links: SpecGraphLink[],
): void {
  const sink: GraphSink = { nodes, links };

  for (const st of spec.stmts ?? []) {
    emitStatementNode(spec.uid, specPath, st, sink);
  }

  for (const ac of spec.acs ?? []) {
    emitAcceptanceCriterionNode(spec.uid, specPath, ac, sink);
  }
}

/** Pure: Dgraph query result → de-duplicated nodes + links. */
export function flattenSpecGraph(graph: GraphResult): SpecGraph {
  const nodes = new Map<string, SpecGraphNode>();
  const links: SpecGraphLink[] = [];

  for (const spec of graph.q ?? []) {
    const specPath = spec["Spec.file_path"] ?? spec.uid;

    nodes.set(spec.uid, {
      id: spec.uid,
      type: "Spec",
      label: specLabel(specPath),
      path: specPath,
    });

    // One node per feature folder (deduped by uid); every md file hangs under it via `in_feature`.
    if (spec.feature) {
      const fp = spec.feature["Feature.path"] ?? spec.feature.uid;

      nodes.set(spec.feature.uid, {
        id: spec.feature.uid,
        type: "Feature",
        label: basename(fp),
        path: fp,
      });
      links.push({
        source: spec.feature.uid,
        target: spec.uid,
        kind: "in_feature",
      });
    }

    emitSpecChildNodes(spec, specPath, nodes, links);
  }

  return { nodes: [...nodes.values()], links };
}
