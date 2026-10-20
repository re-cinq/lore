import "server-only";
import { getGraphBrowse, searchMemory } from "./memory";
import type { components } from "./schema";

// One knowledge-graph entity: its relationships over time and what memory says about it, composed from the graph browser's and the search page's reads.

type Browse = components["schemas"]["GraphBrowse"];
type BrowseEdge = Browse["edges"][number];
type BrowseEntity = Browse["entities"][number];

export interface EntityRelationship {
  relation: string;
  /** `out` when this entity is the edge's source. */
  direction: "out" | "in";
  other: string;
  otherType: string;
  since: string;
  /** When the relationship stopped holding; null while it still does. */
  until: string | null;
  from: string;
}

export interface EntityFact {
  key: string;
  text: string;
  source: string;
  agentId: string | null;
}

export interface EntityDetail {
  name: string;
  type: string | null;
  repo: string | null;
  activeCount: number;
  relationships: EntityRelationship[];
  facts: EntityFact[];
}

/** The entity, or null when the graph holds nothing under that name. */
export async function getEntity(name: string): Promise<EntityDetail | null> {
  const [browse, search] = await Promise.all([
    getGraphBrowse({ entity: name, showInvalid: true }),
    searchMemory(name),
  ]);
  const graph =
    browse.status === "ok" ? (browse.data as unknown as Browse) : null;
  const hits = search.status === "ok" ? search.data.results : [];

  return graph ? entityOf(name, graph, hits) : null;
}

/** Folds the browse answer into one entity's view; null when neither an entity row nor an edge names it. */
export function entityOf(
  name: string,
  graph: Pick<Browse, "entities" | "edges">,
  hits: readonly Record<string, unknown>[],
): EntityDetail | null {
  const row = graph.entities.find((e) => sameName(e.name, name));
  const relationships = graph.edges.map((e) => relationshipOf(name, e));

  if (!row && relationships.length === 0) {
    return null;
  }

  return {
    ...identityOf(name, row, graph.edges),
    activeCount: relationships.filter((r) => r.until === null).length,
    relationships: relationships.sort(
      (a, b) => Date.parse(b.since) - Date.parse(a.since),
    ),
    facts: hits.map(factOf),
  };
}

function sameName(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/** Name, type and repo from the entity row when the browse page carried it, else the type an edge records for it. */
function identityOf(
  name: string,
  row: BrowseEntity | undefined,
  edges: readonly BrowseEdge[],
) {
  if (row) {
    return { name: row.name, type: row.entity_type, repo: row.repo };
  }

  return { name, type: edgeTypeOf(name, edges.at(0)), repo: null };
}

/** The type an edge records for the named end of it. */
function edgeTypeOf(name: string, edge: BrowseEdge | undefined): string | null {
  if (!edge) {
    return null;
  }

  return sameName(edge.source_name, name) ? edge.source_type : edge.target_type;
}

function relationshipOf(name: string, edge: BrowseEdge): EntityRelationship {
  const out = sameName(edge.source_name, name);

  return {
    relation: edge.relation_type,
    direction: out ? "out" : "in",
    other: out ? edge.target_name : edge.source_name,
    otherType: out ? edge.target_type : edge.source_type,
    since: edge.valid_from,
    until: edge.valid_to,
    from: edge.source_label,
  };
}

function factOf(hit: Record<string, unknown>): EntityFact {
  return {
    key: String(hit.key ?? ""),
    text: String(hit.value ?? ""),
    source: String(hit.source ?? "memory"),
    agentId: typeof hit.agent_id === "string" ? hit.agent_id : null,
  };
}
