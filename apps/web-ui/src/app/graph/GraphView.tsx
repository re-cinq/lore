import type { ReactNode } from "react";
import styles from "./GraphView.module.css";
import type { components } from "@/lib/api/schema";
import DataTable from "@/components/DataTable";

// Aliases over /api/graph-browse; Entity/Edge include subqueries, route states them.

type Browse = components["schemas"]["GraphBrowse"];

export type Entity = Browse["entities"][number];
export type Edge = Browse["edges"][number];
export type Stats = Browse["stats"];
export type EntityTypeCount = Browse["entity_types"][number];

const TYPE_BADGE = "op-badge";
const TYPE_BADGE_ACTIVE = "op-badge op-search";

export interface GraphViewProps {
  /** The selected entity name, or undefined when none is being explored. */
  entity?: string;
  /** The active entity-type filter, or undefined for "all". */
  type?: string;
  /** Whether invalidated edges are shown for the selected entity. */
  showInvalid: boolean;
  stats: Stats;
  entityTypes: EntityTypeCount[];
  entities: Entity[];
  edges: Edge[];
}

/** Knowledge graph explorer; pure render with memory.* queries from container. */
export default function GraphView({
  entity,
  type,
  showInvalid,
  stats,
  entityTypes,
  entities,
  edges,
}: GraphViewProps) {
  return (
    <div>
      <GraphHeading />
      <GraphStats stats={stats} />
      <TypeFilters entityTypes={entityTypes} type={type} />
      <EntityTable entities={entities} entity={entity} type={type} />
      <EdgeTable entity={entity} edges={edges} showInvalid={showInvalid} />
    </div>
  );
}

function GraphHeading() {
  return (
    <>
      <h1>Knowledge Graph</h1>
      <p className={`meta ${styles.intro}`}>
        Live knowledge graph built from episodes and memories. Entities and
        relationships are extracted automatically.
      </p>
    </>
  );
}

function GraphStats({ stats }: Pick<GraphViewProps, "stats">) {
  const cards: [number, string][] = [
    [stats.entity_count, "Entities"],
    [stats.active_edge_count, "Active edges"],
    [stats.invalidated_edge_count, "Invalidated edges"],
  ];

  return (
    <div className={styles.statRow}>
      {cards.map(([value, label]) => (
        <div className="stat-card" key={label}>
          <div className="stat-value">{value}</div>
          <div className="stat-label">{label}</div>
        </div>
      ))}
    </div>
  );
}

type TypeFiltersProps = Pick<GraphViewProps, "entityTypes" | "type">;

/** Nothing to filter by until the graph holds at least one entity type. */
function TypeFilters({ entityTypes, type }: TypeFiltersProps) {
  if (entityTypes.length === 0) {
    return null;
  }

  return (
    <div className={styles.filterRow}>
      <a href="/graph" className={type ? TYPE_BADGE : TYPE_BADGE_ACTIVE}>
        all
      </a>
      {entityTypes.map((t) => (
        <TypeFilterLink
          key={t.entity_type}
          entityType={t}
          active={type === t.entity_type}
        />
      ))}
    </div>
  );
}

interface TypeFilterLinkProps {
  entityType: EntityTypeCount;
  active: boolean;
}

function TypeFilterLink({ entityType, active }: TypeFilterLinkProps) {
  return (
    <a
      href={`/graph?type=${entityType.entity_type}`}
      className={active ? TYPE_BADGE_ACTIVE : TYPE_BADGE}
    >
      {entityType.entity_type} ({entityType.cnt})
    </a>
  );
}

/** One entity as a row, with the link that recentres the graph on it. The type filter is carried into that link so exploring an entity does not silently widen the view back to every type. */
function entityCells(
  entity: GraphViewProps["entities"][number],
  type: GraphViewProps["type"],
): ReactNode[] {
  const exploreHref = `/graph?entity=${encodeURIComponent(entity.name)}${type ? `&type=${type}` : ""}`;

  return [
    <strong key="name">{entity.name}</strong>,
    <span className="op-badge" key="type">
      {entity.entity_type}
    </span>,
    entity.repo || "—",
    entity.edge_count,
    new Date(entity.updated_at).toLocaleDateString(),
    <a key="explore" href={exploreHref}>
      explore
    </a>,
  ];
}

type EntityTableProps = Pick<GraphViewProps, "entities" | "entity" | "type">;

function EntityTable({ entities, entity, type }: EntityTableProps) {
  return (
    <DataTable
      title="Entities"
      columns={["Name", "Type", "Repo", "Edges", "Updated", ""]}
      rows={entities}
      rowKey={(e) => e.id}
      rowClass={(e) =>
        entity?.toLowerCase() === e.name.toLowerCase()
          ? styles.activeRow
          : undefined
      }
      empty="No entities yet. Write episodes to populate the graph."
      cells={(e) => entityCells(e, type)}
    />
  );
}

/** One relationship row. An invalidated edge keeps its dates and is styled rather than hidden — that a relationship USED to hold is part of what the graph records. */
function edgeCells(e: GraphViewProps["edges"][number]): ReactNode[] {
  return [
    edgeEndpointCell(e.source_name, e.source_type, "source"),
    <span className="op-badge" key="rel">
      {e.relation_type}
    </span>,
    edgeEndpointCell(e.target_name, e.target_type, "target"),
    new Date(e.valid_from).toLocaleDateString(),
    edgeStatusCell(e.valid_to),
    <span className="meta" key="from">
      {e.source_label}
    </span>,
  ];
}

/** One end of a relationship: the entity's name, with its type alongside. */
function edgeEndpointCell(
  name: Edge["source_name"],
  entityType: Edge["source_type"],
  key: string,
): ReactNode {
  return (
    <span key={key}>
      <strong>{name}</strong> <span className="meta">({entityType})</span>
    </span>
  );
}

function edgeStatusCell(validTo: Edge["valid_to"]): ReactNode {
  return validTo ? (
    <span className="op-badge op-delete" key="status">
      invalidated {new Date(validTo).toLocaleDateString()}
    </span>
  ) : (
    <span className="op-badge op-write" key="status">
      active
    </span>
  );
}

type EdgeTableProps = Pick<GraphViewProps, "entity" | "edges" | "showInvalid">;

/** An invalidated edge is history, not noise — it stays available behind the toggle so a contradiction can be read after the fact. Relationships need an entity to hang off, so with none selected there is nothing to show. */
function EdgeTable({ entity, edges, showInvalid }: EdgeTableProps) {
  if (!entity) {
    return null;
  }

  return (
    <>
      <h2>Relationships for &quot;{entity}&quot;</h2>
      <InvalidEdgesToggle entity={entity} showInvalid={showInvalid} />
      <DataTable
        columns={["Source", "Relation", "Target", "Since", "Status", "From"]}
        rows={edges}
        rowKey={(_e, i) => String(i)}
        rowClass={(e) => (e.valid_to ? styles.invalidatedRow : undefined)}
        empty="No relationships found for this entity."
        cells={edgeCells}
      />
    </>
  );
}

type InvalidEdgesToggleProps = Pick<GraphViewProps, "showInvalid"> & {
  entity: string;
};

function InvalidEdgesToggle({ entity, showInvalid }: InvalidEdgesToggleProps) {
  return (
    <div className={styles.invalidToggle}>
      <a
        href={`/graph?entity=${encodeURIComponent(entity)}${showInvalid ? "" : "&show_invalid=1"}`}
        className={styles.invalidToggleLink}
      >
        {showInvalid ? "Hide invalidated" : "Show invalidated edges"}
      </a>
    </div>
  );
}
