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
      <div className={styles.cardHead}>
        <span className={styles.cardTitle}>{section.header}</span>
        <span className="badge badge-gray">{section.source}</span>
        <span className="meta">P{section.priority}</span>
        <span className={statusBadgeClass(section)}>
          {statusLabel(section)}
        </span>
        <span className={`meta ${styles.spacer}`}>
          {section.finalTokens} / {section.allocatedBudget || section.rawTokens}{" "}
          tok
        </span>
      </div>
      {section.allocatedBudget > 0 && (
        <div className={styles.barWrap}>
          <Bar used={section.finalTokens} total={section.allocatedBudget} />
        </div>
      )}
      {section.items.length > 0 && (
        <details className={styles.docs}>
          <summary className={`meta ${styles.docsSummary}`}>
            {section.items.length} contributing document
            {section.items.length === 1 ? "" : "s"}
          </summary>
          <ul className={styles.docList}>
            {section.items.map((document, i) => (
              <li key={i} className={styles.docItem}>
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
                <span className="meta">{document.tokens} tok</span>
                {typeof document.score === "number" && (
                  <span className="meta">rel {document.score.toFixed(2)}</span>
                )}
                {document.ingested_at && (
                  <span className="meta">
                    {document.ingested_at.slice(0, 10)}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
