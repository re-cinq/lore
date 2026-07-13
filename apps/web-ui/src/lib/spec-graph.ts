// Type shapes for the spec-traceability force-graph, consumed by SpecGraphD3 and
// the /trace API client. The Dgraph queries + flatten logic now live in
// @re-cinq/lore-shared (spec-trace/spec-graph.ts) and are served via the
// mcp-server /trace/{graph,ring} endpoints — web-ui no longer queries Dgraph
// directly. web-ui is not a workspace member, so these mirror the API JSON.

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

export type SpecGraphNode = {
  id: string;
  type: SpecGraphNodeType;
  label: string;
  path?: string;
  line?: number;
  endLine?: number;
  detail?: string;
  // Persistent feature lifecycle status + row id, when a Feature node is backed
  // by a lore.features row (ADR-027). Drives status coloring + click-through.
  status?: string;
  featureId?: string;
};

export type SpecGraphLink = {
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
};

export interface SpecGraph {
  nodes: SpecGraphNode[];
  links: SpecGraphLink[];
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
