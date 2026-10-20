import Link from "next/link";
import { EmptyState } from "@/components/EmptyState";
import Icon from "@/components/Icon";
import type { EntityDetail, EntityFact } from "@/lib/api/entities";
import EntityRelationships from "./EntityRelationships";
import styles from "./EntityView.module.css";

export interface EntityViewProps {
  /** The name the URL asked for, shown even when the graph has no such entity. */
  name: string;
  entity: EntityDetail | null;
}

/** One entity: who it is, how its relationships changed, and what memory holds about it. */
export default function EntityView({ name, entity }: EntityViewProps) {
  return (
    <div className={styles.screen}>
      <nav aria-label="Breadcrumb" className={styles.crumbs}>
        <Link href="/graph">Graph</Link>
        <span aria-hidden="true">/</span>
        <span>{entity?.name ?? name}</span>
      </nav>
      {entity ? <EntityBody entity={entity} /> : <EntityMissing name={name} />}
    </div>
  );
}

function EntityMissing({ name }: { name: string }) {
  return (
    <EmptyState
      title={`The graph holds no entity called "${name}"`}
      description="Entities are extracted from episodes and memories as they are written."
      action={{ href: "/graph", label: "Browse the graph" }}
    />
  );
}

function EntityBody({ entity }: { entity: EntityDetail }) {
  return (
    <>
      <EntityHeader entity={entity} />
      <div className={styles.columns}>
        <EntityRelationships relationships={entity.relationships} />
        <EntityFacts facts={entity.facts} />
      </div>
    </>
  );
}

function EntityHeader({ entity }: { entity: EntityDetail }) {
  return (
    <header className={styles.header}>
      <span className={styles.titleBlock}>
        <EntityMeta entity={entity} />
        <h1 className={styles.title}>{entity.name}</h1>
      </span>
      <Link
        href={`/graph?entity=${encodeURIComponent(entity.name)}`}
        className={styles.graphLink}
      >
        <Icon name="navGraph" />
        Open in graph
      </Link>
    </header>
  );
}

function EntityMeta({ entity }: { entity: EntityDetail }) {
  return (
    <span className={styles.meta}>
      {entity.type ? <span className={styles.type}>{entity.type}</span> : null}
      <span>
        {entity.repo ? `${entity.repo} · ` : ""}
        {entity.activeCount} active relationships
      </span>
    </span>
  );
}

function EntityFacts({ facts }: { facts: EntityFact[] }) {
  return (
    <section className={styles.side} aria-labelledby="entity-facts">
      <h2 id="entity-facts" className={styles.cardTitle}>
        What Lore knows
      </h2>
      {facts.length === 0 ? (
        <p className="meta">No memory or fact mentions it yet.</p>
      ) : (
        <ul className={styles.facts}>
          {facts.map((fact, i) => (
            <FactItem key={`${fact.key}-${i}`} fact={fact} />
          ))}
        </ul>
      )}
    </section>
  );
}

function FactItem({ fact }: { fact: EntityFact }) {
  return (
    <li className={styles.fact}>
      <span className={styles.factMeta}>
        <span className={styles.kind}>{fact.source}</span>
        <span className={styles.key}>{fact.key}</span>
      </span>
      <span className={styles.factText}>{fact.text}</span>
      {fact.agentId ? (
        <span className={styles.by}>from {fact.agentId.slice(0, 8)}</span>
      ) : null}
    </li>
  );
}
