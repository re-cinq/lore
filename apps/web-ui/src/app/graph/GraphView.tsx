import styles from "./GraphView.module.css";
import type { components } from "@/lib/api/schema";
import ScreenHeader from "@/components/ScreenHeader";
import FilterChips, { type FilterChip } from "@/components/FilterChips";
import { StatusPill } from "@/components/StatusPill";
import { entityTone, graphHref } from "./entity-tone";

// Aliases over /api/graph-browse; Entity/Edge include subqueries, route states them.

type Browse = components["schemas"]["GraphBrowse"];

export type Entity = Browse["entities"][number];
export type Edge = Browse["edges"][number];
export type Stats = Browse["stats"];
export type EntityTypeCount = Browse["entity_types"][number];

const LEDE =
  "Built from episodes and memories. Entities and relationships are extracted automatically; a relationship that stops holding is invalidated, not deleted.";

const NO_ENTITIES = "No entities yet. Write episodes to populate the graph.";

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
export default function GraphView(props: GraphViewProps) {
  const { entity, type, stats, entityTypes, entities } = props;

  return (
    <div>
      <ScreenHeader group="knowledge" title="Knowledge graph" lede={LEDE} />
      <GraphStats stats={stats} />
      <TypeFilters entityTypes={entityTypes} type={type} />
      <div className={styles.split}>
        <EntityList entities={entities} entity={entity} type={type} />
        {entities.length > 0 || entity ? <RelationsPanel {...props} /> : null}
      </div>
    </div>
  );
}

/** The three graph totals; the first is the lead figure, so it is filled. */
function GraphStats({ stats }: Pick<GraphViewProps, "stats">) {
  const cards: [number, string][] = [
    [stats.entity_count, "Entities"],
    [stats.active_edge_count, "Active edges"],
    [stats.invalidated_edge_count, "Invalidated edges"],
  ];

  return (
    <div className={styles.stats}>
      {cards.map(([value, label], i) => (
        <div className={i === 0 ? styles.statLead : styles.stat} key={label}>
          <span className={styles.statLabel}>{label}</span>
          <span className={styles.statValue}>{formatCount(value)}</span>
        </div>
      ))}
    </div>
  );
}

/** A count as the reader expects it; a missing figure reads as nought. */
function formatCount(value: number | undefined): string {
  return Number.isFinite(value) ? Number(value).toLocaleString() : "0";
}

type TypeFiltersProps = Pick<GraphViewProps, "entityTypes" | "type">;

/** Nothing to filter by until the graph holds at least one entity type. */
function TypeFilters({ entityTypes, type }: TypeFiltersProps) {
  if (entityTypes.length === 0) {
    return null;
  }
  const chips: FilterChip[] = [
    { label: "all", href: "/graph", active: !type, tone: "neutral" },
    ...entityTypes.map((t) => ({
      label: t.entity_type,
      href: graphHref({ type: t.entity_type }),
      active: type === t.entity_type,
      count: t.cnt,
      tone: entityTone(t.entity_type),
    })),
  ];

  return <FilterChips label="Entity types" chips={chips} />;
}

type EntityListProps = Pick<GraphViewProps, "entities" | "entity" | "type">;

function EntityList({ entities, entity, type }: EntityListProps) {
  return (
    <section className={`${styles.card} ${styles.entities}`}>
      <header className={styles.cardHead}>
        <h2 className={styles.cardTitle}>Entities</h2>
        <span className={styles.hint}>Select one to explore</span>
      </header>
      <EntityRows entities={entities} entity={entity} type={type} />
    </section>
  );
}

function EntityRows({ entities, entity, type }: EntityListProps) {
  if (entities.length === 0) {
    return <p className={styles.empty}>{NO_ENTITIES}</p>;
  }
  const selected = entity?.toLowerCase();

  return (
    <ul className={styles.entityList}>
      {entities.map((e) => (
        <EntityRow
          key={e.id}
          entity={e}
          type={type}
          selected={selected === e.name.toLowerCase()}
        />
      ))}
    </ul>
  );
}

interface EntityRowProps {
  entity: Entity;
  type: GraphViewProps["type"];
  selected: boolean;
}

/** One entity, as the link that recentres the graph on it. The type filter is carried into that link so exploring an entity does not silently widen the view back to every type. */
function EntityRow({ entity, type, selected }: EntityRowProps) {
  return (
    <li>
      <a
        href={graphHref({ entity: entity.name, type })}
        aria-current={selected ? "true" : undefined}
        className={styles.entityRow}
        title={`Updated ${new Date(entity.updated_at).toLocaleDateString()}`}
      >
        <EntityName entity={entity} />
        <StatusPill
          label={entity.entity_type}
          tone={entityTone(entity.entity_type)}
        />
        <span className={styles.entityEdges}>{entity.edge_count} edges</span>
      </a>
    </li>
  );
}

/** The entity's name over the repo it belongs to, or a dash for none. */
function EntityName({ entity }: { entity: Entity }) {
  return (
    <span className={styles.entityName}>
      <strong>{entity.name}</strong>
      <span className={styles.muted}>{entity.repo || "—"}</span>
    </span>
  );
}

/** An invalidated edge is history, not noise — it stays available behind the toggle so a contradiction can be read after the fact. Relationships need an entity to hang off, so with none selected the panel only says how to get some. */
function RelationsPanel({ entity, type, edges, showInvalid }: GraphViewProps) {
  if (!entity) {
    return <RelationsIdle />;
  }

  return (
    <section className={`${styles.card} ${styles.panel}`}>
      <header className={styles.panelHead}>
        <h2 className={styles.panelTitle}>
          <span className={styles.panelEyebrow}>Relationships for</span>{" "}
          <span className={styles.panelName}>{entity}</span>
        </h2>
        <span className={styles.panelActions}>
          <EntityPageLink entity={entity} />
          <InvalidEdgesToggle query={{ entity, type, showInvalid }} />
        </span>
      </header>
      <EdgeList edges={edges} />
    </section>
  );
}

/** The entity's own page: its relationships over time and what Lore knows about it. */
function EntityPageLink({ entity }: { entity: string }) {
  return (
    <a
      href={`/entities/${encodeURIComponent(entity)}`}
      className={styles.toggle}
    >
      Open entity page
    </a>
  );
}

/** Flips whether invalidated edges are listed, keeping the entity and type. */
function InvalidEdgesToggle({
  query,
}: {
  query: Parameters<typeof graphHref>[0];
}) {
  return (
    <a
      href={graphHref({ ...query, showInvalid: !query.showInvalid })}
      className={styles.toggle}
    >
      {query.showInvalid ? "Hide invalidated" : "Show invalidated edges"}
    </a>
  );
}

function RelationsIdle() {
  return (
    <section className={`${styles.card} ${styles.panel} ${styles.panelIdle}`}>
      <p className={styles.muted}>
        Select an entity to see what it is connected to.
      </p>
    </section>
  );
}

function EdgeList({ edges }: Pick<GraphViewProps, "edges">) {
  if (edges.length === 0) {
    return (
      <p className={styles.empty}>No relationships found for this entity.</p>
    );
  }

  return (
    <ul className={styles.edgeList}>
      {edges.map((e, i) => (
        <EdgeCard key={i} edge={e} />
      ))}
    </ul>
  );
}

/** One relationship. An invalidated edge keeps its dates and is dimmed rather than hidden — that a relationship USED to hold is part of what the graph records. */
function EdgeCard({ edge }: { edge: Edge }) {
  const className = edge.valid_to
    ? `${styles.edge} ${styles.edgeInvalid}`
    : styles.edge;

  return (
    <li className={className}>
      <span className={styles.edgeLine}>
        <Endpoint name={edge.source_name} entityType={edge.source_type} />
        <span className={styles.relation}>{edge.relation_type}</span>
        <Endpoint name={edge.target_name} entityType={edge.target_type} />
      </span>
      <span className={styles.edgeMeta}>
        <EdgeStatus validTo={edge.valid_to} />
        <span>since {new Date(edge.valid_from).toLocaleDateString()}</span>
        <span>from {edge.source_label}</span>
      </span>
    </li>
  );
}

/** One end of a relationship: the entity's name, with its type alongside. */
function Endpoint(props: { name: string; entityType: string }) {
  return (
    <span className={styles.endpoint}>
      <strong>{props.name}</strong>{" "}
      <span className={styles.endpointType}>{props.entityType}</span>
    </span>
  );
}

function EdgeStatus({ validTo }: { validTo: Edge["valid_to"] }) {
  return validTo ? (
    <StatusPill
      tone="err"
      label={`invalidated ${new Date(validTo).toLocaleDateString()}`}
    />
  ) : (
    <StatusPill tone="ok" label="active" />
  );
}
