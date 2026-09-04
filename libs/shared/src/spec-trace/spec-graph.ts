// spec-traceability-graph — force-graph + spec-ring projections read from Dgraph via the Project facade; relocated from web-ui/src/lib/spec-graph.ts.
import type { DgraphClientPort } from "./deps.js";
import { withTxn } from "./dgraph-upsert.js";
import {
  flattenSpecGraph,
  specLabel,
  adrLabel,
  type GraphResult,
} from "./spec-graph-flatten.js";

export { flattenSpecGraph, specLabel, adrLabel };

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
