// Mirrors API JSON shapes for spec-traceability force-graph (queries in @re-cinq/lore-shared, served via mcp /trace).

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
  // Feature lifecycle status (from lore.features row, ADR-027).
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
