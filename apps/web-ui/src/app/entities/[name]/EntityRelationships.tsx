import Link from "next/link";
import type { EntityRelationship } from "@/lib/api/entities";
import styles from "./EntityRelationships.module.css";

interface RelationshipsProps {
  relationships: EntityRelationship[];
}

/** Every relationship the entity has held, newest first; one that stopped holding keeps its dates and is marked ended. */
export default function EntityRelationships({
  relationships,
}: RelationshipsProps) {
  return (
    <section className={styles.card} aria-labelledby="entity-relationships">
      <header className={styles.top}>
        <h2 id="entity-relationships" className={styles.title}>
          Relationships over time
        </h2>
        <span className={styles.count}>{relationships.length} recorded</span>
      </header>
      <Timeline relationships={relationships} />
    </section>
  );
}

function Timeline({ relationships }: RelationshipsProps) {
  if (relationships.length === 0) {
    return (
      <p className={`meta ${styles.empty}`}>No relationships recorded yet.</p>
    );
  }

  return (
    <ol className={styles.timeline}>
      {relationships.map((rel, i) => (
        <RelationshipItem key={`${rel.relation}-${rel.other}-${i}`} rel={rel} />
      ))}
    </ol>
  );
}

function RelationshipItem({ rel }: { rel: EntityRelationship }) {
  const ended = rel.until !== null;

  return (
    <li className={ended ? `${styles.item} ${styles.ended}` : styles.item}>
      <span className={styles.when}>{periodOf(rel)}</span>
      <RelationshipEdge rel={rel} ended={ended} />
      <span className={styles.from}>from {rel.from}</span>
    </li>
  );
}

/** `since` alone while it holds, `since – until` once it ended. */
function periodOf(rel: EntityRelationship): string {
  const since = new Date(rel.since).toLocaleDateString();

  return rel.until
    ? `${since} – ${new Date(rel.until).toLocaleDateString()}`
    : since;
}

interface RelationshipEdgeProps {
  rel: EntityRelationship;
  ended: boolean;
}

function RelationshipEdge({ rel, ended }: RelationshipEdgeProps) {
  const relation =
    rel.direction === "out" ? rel.relation : `${rel.relation} (from)`;

  return (
    <span className={styles.edge}>
      <span className={styles.relation}>{relation}</span>
      <Link
        href={`/entities/${encodeURIComponent(rel.other)}`}
        className={styles.other}
      >
        {rel.other}
      </Link>
      <span className={styles.otherType}>{rel.otherType}</span>
      <span className={ended ? styles.endedPill : styles.activePill}>
        {ended ? "ended" : "active"}
      </span>
    </span>
  );
}
