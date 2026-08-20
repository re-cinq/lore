import styles from "./GraphView.module.css";
import type { components } from "@/lib/api/schema";

// Aliases over the /api/graph-browse contract. None of these is a table row:
// `Entity` carries an edge-count subquery and `Edge` is a three-way join that
// reads names rather than ids, so the route states them and this reads them.

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

/**
 * Presentational view for the knowledge graph explorer. Pure render — the
 * container (`page.tsx`) runs the queries against `memory.*` and passes the
 * resolved view-model down.
 */
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

      <div className={styles.statRow}>
        <div className="stat-card">
          <div className="stat-value">{stats.entity_count}</div>
          <div className="stat-label">Entities</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{stats.active_edge_count}</div>
          <div className="stat-label">Active edges</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{stats.invalidated_edge_count}</div>
          <div className="stat-label">Invalidated edges</div>
        </div>
      </div>

      {entityTypes.length > 0 && (
        <div className={styles.filterRow}>
          <a
            href="/graph"
            className={!type ? "op-badge op-search" : "op-badge"}
          >
            all
          </a>
          {entityTypes.map((t) => (
            <a
              key={t.entity_type}
              href={`/graph?type=${t.entity_type}`}
              className={
                type === t.entity_type ? "op-badge op-search" : "op-badge"
              }
            >
              {t.entity_type} ({t.cnt})
            </a>
          ))}
        </div>
      )}

      <h2>Entities</h2>
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Type</th>
            <th>Repo</th>
            <th>Edges</th>
            <th>Updated</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {entities.map((e) => (
            <tr
              key={e.id}
              className={
                entity?.toLowerCase() === e.name.toLowerCase()
                  ? styles.activeRow
                  : undefined
              }
            >
              <td>
                <strong>{e.name}</strong>
              </td>
              <td>
                <span className="op-badge">{e.entity_type}</span>
              </td>
              <td>{e.repo || "—"}</td>
              <td>{e.edge_count}</td>
              <td>{new Date(e.updated_at).toLocaleDateString()}</td>
              <td>
                <a
                  href={`/graph?entity=${encodeURIComponent(e.name)}${type ? `&type=${type}` : ""}`}
                >
                  explore
                </a>
              </td>
            </tr>
          ))}
          {entities.length === 0 && (
            <tr>
              <td colSpan={6} className={styles.emptyCell}>
                No entities yet. Write episodes to populate the graph.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {entity && (
        <>
          <h2>Relationships for &quot;{entity}&quot;</h2>
          <div className={styles.invalidToggle}>
            <a
              href={`/graph?entity=${encodeURIComponent(entity)}${showInvalid ? "" : "&show_invalid=1"}`}
              className={styles.invalidToggleLink}
            >
              {showInvalid ? "Hide invalidated" : "Show invalidated edges"}
            </a>
          </div>
          <table>
            <thead>
              <tr>
                <th>Source</th>
                <th>Relation</th>
                <th>Target</th>
                <th>Since</th>
                <th>Status</th>
                <th>From</th>
              </tr>
            </thead>
            <tbody>
              {edges.map((e, i) => (
                <tr
                  key={i}
                  className={e.valid_to ? styles.invalidatedRow : undefined}
                >
                  <td>
                    <strong>{e.source_name}</strong>{" "}
                    <span className="meta">({e.source_type})</span>
                  </td>
                  <td>
                    <span className="op-badge">{e.relation_type}</span>
                  </td>
                  <td>
                    <strong>{e.target_name}</strong>{" "}
                    <span className="meta">({e.target_type})</span>
                  </td>
                  <td>{new Date(e.valid_from).toLocaleDateString()}</td>
                  <td>
                    {e.valid_to ? (
                      <span className="op-badge op-delete">
                        invalidated {new Date(e.valid_to).toLocaleDateString()}
                      </span>
                    ) : (
                      <span className="op-badge op-write">active</span>
                    )}
                  </td>
                  <td>
                    <span className="meta">{e.source_label}</span>
                  </td>
                </tr>
              ))}
              {edges.length === 0 && (
                <tr>
                  <td colSpan={6} className={styles.emptyCell}>
                    No relationships found for this entity.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
