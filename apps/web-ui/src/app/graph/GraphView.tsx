import styles from "./GraphView.module.css";
import type { components } from "@/lib/api/schema";
import DataTable from "@/components/DataTable";

// Aliases over /api/graph-browse; Entity/Edge include subqueries, route states them.

type Browse = components["schemas"]["GraphBrowse"];

export type Entity = Browse["entities"][number];
export type Edge = Browse["edges"][number];
export type Stats = Browse["stats"];
export type EntityTypeCount = Browse["entity_types"][number];

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
      <h1>Knowledge Graph</h1>
      <p className={`meta ${styles.intro}`}>
        Live knowledge graph built from episodes and memories. Entities and
        relationships are extracted automatically.
      </p>
      <GraphStats stats={stats} />
      {entityTypes.length > 0 && (
        <TypeFilters entityTypes={entityTypes} type={type} />
      )}
      <EntityTable entities={entities} entity={entity} type={type} />
      {entity && (
        <EdgeTable entity={entity} edges={edges} showInvalid={showInvalid} />
      )}
    </div>
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

function TypeFilters({
  entityTypes,
  type,
}: Pick<GraphViewProps, "entityTypes" | "type">) {
  const badge = (active: boolean) =>
    active ? "op-badge op-search" : "op-badge";

  return (
    <div className={styles.filterRow}>
      <a href="/graph" className={badge(!type)}>
        all
      </a>
      {entityTypes.map((t) => (
        <a
          key={t.entity_type}
          href={`/graph?type=${t.entity_type}`}
          className={badge(type === t.entity_type)}
        >
          {t.entity_type} ({t.cnt})
        </a>
      ))}
    </div>
  );
}

function EntityTable({
  entities,
  entity,
  type,
}: Pick<GraphViewProps, "entities" | "entity" | "type">) {
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
      cells={(e) => [
        <strong key="name">{e.name}</strong>,
        <span className="op-badge" key="type">
          {e.entity_type}
        </span>,
        e.repo || "—",
        e.edge_count,
        new Date(e.updated_at).toLocaleDateString(),
        <a
          key="explore"
          href={`/graph?entity=${encodeURIComponent(e.name)}${type ? `&type=${type}` : ""}`}
        >
          explore
        </a>,
      ]}
    />
  );
}

/** An invalidated edge is history, not noise — it stays available behind the toggle so a contradiction can be read after the fact. */
function EdgeTable({
  entity,
  edges,
  showInvalid,
}: Pick<GraphViewProps, "entity" | "edges" | "showInvalid">) {
  return (
    <>
      <h2>Relationships for &quot;{entity}&quot;</h2>
      <div className={styles.invalidToggle}>
        <a
          href={`/graph?entity=${encodeURIComponent(entity ?? "")}${showInvalid ? "" : "&show_invalid=1"}`}
          className={styles.invalidToggleLink}
        >
          {showInvalid ? "Hide invalidated" : "Show invalidated edges"}
        </a>
      </div>
      <DataTable
        columns={["Source", "Relation", "Target", "Since", "Status", "From"]}
        rows={edges}
        rowKey={(_e, i) => String(i)}
        rowClass={(e) => (e.valid_to ? styles.invalidatedRow : undefined)}
        empty="No relationships found for this entity."
        cells={(e) => [
          <span key="source">
            <strong>{e.source_name}</strong>{" "}
            <span className="meta">({e.source_type})</span>
          </span>,
          <span className="op-badge" key="rel">
            {e.relation_type}
          </span>,
          <span key="target">
            <strong>{e.target_name}</strong>{" "}
            <span className="meta">({e.target_type})</span>
          </span>,
          new Date(e.valid_from).toLocaleDateString(),
          e.valid_to ? (
            <span className="op-badge op-delete" key="status">
              invalidated {new Date(e.valid_to).toLocaleDateString()}
            </span>
          ) : (
            <span className="op-badge op-write" key="status">
              active
            </span>
          ),
          <span className="meta" key="from">
            {e.source_label}
          </span>,
        ]}
      />
    </>
  );
}
