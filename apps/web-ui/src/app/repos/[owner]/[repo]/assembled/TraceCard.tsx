import { badgeClassForType, labelForType } from "@/lib/content-types";
import type { TraceSection } from "./trace-types";
import styles from "./AssembledContextView.module.css";

/** Status → badge color, so an empty/error section reads at a glance. */
function statusBadgeClass(section: TraceSection): string {
  if (section.included) {
    return section.truncated ? "badge badge-yellow" : "badge badge-green";
  }

  if (section.status === "error") {
    return "badge badge-red";
  }

  return "badge badge-gray";
}

function statusLabel(section: TraceSection): string {
  if (section.included) {
    return section.truncated ? "included · truncated" : "included";
  }

  return `omitted · ${section.omitReason ?? section.status}`;
}

/** Used/total bar for budget + per-section; fill width passed to stylesheet. */
export function Bar({ used, total }: { used: number; total: number }) {
  const pct = total > 0 ? Math.min(100, (used / total) * 100) : 0;

  return (
    <div className={styles.bar}>
      <div
        data-token-bar
        className={styles.barFill}
        style={{ ["--fill-width" as string]: `${pct}%` }}
      />
    </div>
  );
}

/** What the document cost and how well it matched. Relevance and ingest date are optional: a document pulled in by rule rather than by search has no score, and one assembled from live state has no ingest date. */
function DocMetrics({ document }: { document: TraceSection["items"][number] }) {
  return (
    <>
      <span className="meta">{document.tokens} tok</span>
      {typeof document.score === "number" && (
        <span className="meta">rel {document.score.toFixed(2)}</span>
      )}
      {document.ingested_at && (
        <span className="meta">{document.ingested_at.slice(0, 10)}</span>
      )}
    </>
  );
}

/** One contributing document, with its provenance. A document with no `source_path` came from memory or a fact rather than a file, so it shows an excerpt instead of a dead link. */
function DocRow({
  document,
  owner,
  repo,
}: {
  document: TraceSection["items"][number];
  owner: string;
  repo: string;
}) {
  return (
    <li className={styles.docItem}>
      {document.content_type && (
        <span className={badgeClassForType(document.content_type)}>
          {labelForType(document.content_type)}
        </span>
      )}
      {document.source_path ? (
        <a
          href={`/repos/${owner}/${repo}/context/${encodeURIComponent(document.source_path)}`}
        >
          {document.source_path}
        </a>
      ) : (
        <span className="meta">{document.text.slice(0, 60)}…</span>
      )}
      <DocMetrics document={document} />
    </li>
  );
}

/** What actually went into this section, collapsed by default: a reader opens it to answer "why did the agent see THIS", which is a question about one section at a time. */
function ContributingDocs({
  documents,
  owner,
  repo,
}: {
  documents: TraceSection["items"];
  owner: string;
  repo: string;
}) {
  if (documents.length === 0) {
    return null;
  }

  return (
    <details className={styles.docs}>
      <summary className={`meta ${styles.docsSummary}`}>
        {documents.length} contributing document
        {documents.length === 1 ? "" : "s"}
      </summary>
      <ul className={styles.docList}>
        {documents.map((document, index) => (
          <DocRow key={index} document={document} owner={owner} repo={repo} />
        ))}
      </ul>
    </details>
  );
}

/** The section's identity and what it spent. The budget falls back to raw tokens when nothing was allocated: a section that was never given a budget still has a size, and "0 tok" would read as though it contributed nothing. */
function CardHead({ section }: { section: TraceSection }) {
  return (
    <div className={styles.cardHead}>
      <span className={styles.cardTitle}>{section.header}</span>
      <span className="badge badge-gray">{section.source}</span>
      <span className="meta">P{section.priority}</span>
      <span className={statusBadgeClass(section)}>{statusLabel(section)}</span>
      <span className={`meta ${styles.spacer}`}>
        {section.finalTokens} / {section.allocatedBudget || section.rawTokens}{" "}
        tok
      </span>
    </div>
  );
}

/** Per-section card: budget, status, documents with provenance (expandable). */
export function TraceCard({
  owner,
  repo,
  section,
}: {
  owner: string;
  repo: string;
  section: TraceSection;
}) {
  return (
    <div className={styles.card}>
      <CardHead section={section} />
      {section.allocatedBudget > 0 && (
        <div className={styles.barWrap}>
          <Bar used={section.finalTokens} total={section.allocatedBudget} />
        </div>
      )}
      <ContributingDocs documents={section.items} owner={owner} repo={repo} />
    </div>
  );
}
