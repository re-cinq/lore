// spec-traceability-graph — force-graph + spec-ring projections read from Dgraph via the Project facade; relocated from web-ui/src/lib/spec-graph.ts.
import type { DgraphClientPort } from "./deps.js";
import { withTxn } from "./dgraph-upsert.js";

export type SpecGraphNodeType =
  | "Feature"
  | "Spec"
  | "Section"
  | "Statement"
  | "AcceptanceCriterion"
  | "TestChunk"
  | "CodeChunk"
  | "File"
  | "ADR";

export interface SpecGraphNode {
  id: string;
  type: SpecGraphNodeType;
  label: string;
  path?: string;
  line?: number;
  endLine?: number;
  detail?: string;
  /** Feature lifecycle status when backed by a lore.features row (ADR-027); drives D3 node coloring. */
  status?: string;
  /** lore.features row id, when this Feature node is backed by one. */
  featureId?: string;
}

/** Mirrors the features port row; kept local so spec-graph stays dependency-free. */
export interface PersistentFeatureNode {
  id: string;
  title: string;
  path: string;
  status: string;
}

// Persistent Feature rows win (ADR-027): enrich a matching computed node, or inject a standalone node for a draft with no spec yet. Pure.
export function mergePersistentFeatures(
  graph: SpecGraph,
  features: PersistentFeatureNode[],
): SpecGraph {
  const byPath = new Map(features.map((f) => [f.path, f]));
  const matched = new Set<string>();
  const nodes = graph.nodes.map((node) => {
    if (node.type !== "Feature" || !node.path) {
      return node;
    }
    const feature = byPath.get(node.path);

    if (!feature) {
      return node;
    }
    matched.add(feature.path);

    return {
      ...node,
      label: feature.title,
      status: feature.status,
      featureId: feature.id,
    };
  });

  for (const feature of features) {
    if (matched.has(feature.path)) {
      continue;
    }
    nodes.push({
      id: `feature:${feature.id}`,
      type: "Feature",
      label: feature.title,
      path: feature.path,
      status: feature.status,
      featureId: feature.id,
    });
  }

  return { nodes, links: graph.links };
}
export interface SpecGraphLink {
  source: string;
  target: string;
  kind:
    | "in_feature"
    | "in_spec"
    | "in_section"
    | "has_statement"
    | "validated_by"
    | "implemented_by"
    | "covers"
    | "decided_by";
}
export interface SpecGraph {
  nodes: SpecGraphNode[];
  links: SpecGraphLink[];
}

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

interface GraphResult {
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

// Emits validated_by/implemented_by/decided_by edges (plus covers fan-out) for one owner; caller emits the owner node + its in_spec link.
function emitOwnerLinks(
  ownerUid: string,
  owner: OwnerLinks,
  nodes: Map<string, SpecGraphNode>,
  links: SpecGraphLink[],
): void {
  for (const t of owner.vb ?? []) {
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

  // implemented_by CodeChunks are aggregated to the same per-path File node for display.
  for (const c of owner.ib ?? []) {
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

  for (const a of owner.db ?? []) {
    const p = a["ADR.file_path"] ?? a.uid;

    nodes.set(a.uid, { id: a.uid, type: "ADR", label: adrLabel(p), path: p });
    links.push({ source: ownerUid, target: a.uid, kind: "decided_by" });
  }
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

function emitSpecChildNodes(
  spec: NonNullable<GraphResult["q"]>[number],
  specPath: string,
  nodes: Map<string, SpecGraphNode>,
  links: SpecGraphLink[],
): void {
  for (const st of spec.stmts ?? []) {
    nodes.set(st.uid, {
      id: st.uid,
      type: "Statement",
      label: "",
      path: specPath,
      detail: (st["Statement.text"] ?? "").trim(),
    });
    links.push({ source: spec.uid, target: st.uid, kind: "in_spec" });
    emitOwnerLinks(st.uid, st, nodes, links);
  }

  for (const ac of spec.acs ?? []) {
    nodes.set(ac.uid, {
      id: ac.uid,
      type: "AcceptanceCriterion",
      label: "",
      path: specPath,
      detail: (ac["AcceptanceCriterion.text"] ?? "").trim(),
    });
    links.push({ source: spec.uid, target: ac.uid, kind: "in_spec" });
    emitOwnerLinks(ac.uid, ac, nodes, links);
  }
}

const GRAPH_DQL = `query specGraph($repo: string) {
  q(func: eq(Spec.repo, $repo)) {
    uid
    Spec.file_path
    feature: Spec.feature { uid Feature.path }
    stmts: ~Statement.spec @filter(has(Statement.validated_by) OR has(Statement.implemented_by) OR has(Statement.decided_by)) {
      uid
      Statement.text
      vb: Statement.validated_by {
        uid TestChunk.file_path TestChunk.test_name TestChunk.start_line TestChunk.end_line
        cov: TestChunk.coverage { covers: Coverage.covers @facets(ranges) { uid File.path } }
      }
      ib: Statement.implemented_by { uid CodeChunk.file_path CodeChunk.start_line }
      db: Statement.decided_by { uid ADR.file_path ADR.number }
    }
    acs: ~AcceptanceCriterion.spec @filter(has(AcceptanceCriterion.validated_by) OR has(AcceptanceCriterion.implemented_by) OR has(AcceptanceCriterion.decided_by)) {
      uid
      AcceptanceCriterion.text
      vb: AcceptanceCriterion.validated_by {
        uid TestChunk.file_path TestChunk.test_name TestChunk.start_line TestChunk.end_line
        cov: TestChunk.coverage { covers: Coverage.covers @facets(ranges) { uid File.path } }
      }
      ib: AcceptanceCriterion.implemented_by { uid CodeChunk.file_path CodeChunk.start_line }
      db: AcceptanceCriterion.decided_by { uid ADR.file_path ADR.number }
    }
  }
}`;

/** Reads a repo's spec force-graph (Specs + linked Statements + their test/code/ADR targets). */
export async function fetchSpecGraph(
  repo: string,
  dgraph: DgraphClientPort,
): Promise<SpecGraph> {
  const graph = await withTxn(dgraph, async (txn) => {
    const res = await txn.queryWithVars(GRAPH_DQL, { $repo: repo });

    return (res.data ?? {}) as GraphResult;
  });

  return flattenSpecGraph(graph);
}

export interface RingSection {
  uid: string;
  heading: string;
  total: number;
  tested: number;
}
export interface RingStatement {
  uid: string;
  sectionUid: string;
  tested: boolean;
  text: string;
}
export interface SpecRing {
  sections: RingSection[];
  statements: RingStatement[];
}

export const UNGROUPED_SECTION = "__ungrouped__";

interface RingResult {
  q?: Array<{
    uid: string;
    sections?: Array<{ uid: string; "Section.heading"?: string }>;
    stmts?: Array<{
      uid: string;
      v?: number;
      "Statement.text"?: string;
      sec?: { uid: string };
    }>;
  }>;
}

function indexRingSections(
  sections: NonNullable<RingResult["q"]>[number]["sections"],
): {
  byUid: Map<string, RingSection>;
  order: string[];
} {
  const byUid = new Map<string, RingSection>();
  const order: string[] = [];

  for (const sec of sections ?? []) {
    byUid.set(sec.uid, {
      uid: sec.uid,
      heading: sec["Section.heading"] ?? "(section)",
      total: 0,
      tested: 0,
    });
    order.push(sec.uid);
  }

  return { byUid, order };
}

function resolveRingOwner(
  secUid: string | undefined,
  byUid: Map<string, RingSection>,
  ungrouped: RingSection,
): RingSection {
  return (secUid && byUid.get(secUid)) || ungrouped;
}

function tallyRingOwner(owner: RingSection, tested: boolean): void {
  owner.total += 1;

  if (tested) {
    owner.tested += 1;
  }
}

function flattenRingStatements(
  stmts: NonNullable<RingResult["q"]>[number]["stmts"],
  byUid: Map<string, RingSection>,
  ungrouped: RingSection,
): RingStatement[] {
  return (stmts ?? []).map((st) => {
    const owner = resolveRingOwner(st.sec?.uid, byUid, ungrouped);
    const tested = (st.v ?? 0) > 0;

    tallyRingOwner(owner, tested);

    return {
      uid: st.uid,
      sectionUid: owner.uid,
      tested,
      text: (st["Statement.text"] ?? "").trim(),
    };
  });
}

/** Pure: a spec's two-ring structure — sections (inner) + per-statement coverage (outer). */
export function flattenSpecRing(graph: RingResult): SpecRing {
  const spec = graph.q?.[0];

  if (!spec) {
    return { sections: [], statements: [] };
  }
  const { byUid, order } = indexRingSections(spec.sections);
  const ungrouped: RingSection = {
    uid: UNGROUPED_SECTION,
    heading: "(ungrouped)",
    total: 0,
    tested: 0,
  };
  const statements = flattenRingStatements(spec.stmts, byUid, ungrouped);
  const sections = order.map((u) => byUid.get(u)!);

  if (ungrouped.total > 0) {
    sections.push(ungrouped);
  }

  return { sections, statements };
}

const RING_DQL = `query ring($xid: string) {
  q(func: eq(Spec.xid, $xid)) {
    uid
    sections: Spec.sections { uid Section.heading }
    stmts: ~Statement.spec { uid v: count(Statement.validated_by) Statement.text sec: Statement.section { uid } }
  }
}`;

/** Reads one spec's two-ring structure (sections + per-statement coverage) for graph expansion. */
export async function fetchSpecRing(
  repo: string,
  specPath: string,
  dgraph: DgraphClientPort,
): Promise<SpecRing> {
  const graph = await withTxn(dgraph, async (txn) => {
    const res = await txn.queryWithVars(RING_DQL, {
      $xid: `${repo}|${specPath}`,
    });

    return (res.data ?? {}) as RingResult;
  });

  return flattenSpecRing(graph);
}
