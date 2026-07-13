import Linkified from "@/components/Linkified";
import styles from "./FailurePanel.module.css";

interface FailureDetail {
  step: string;
  category?: string;
  error: string;
  hint?: string;
}

interface FailureMetadata {
  error?: string;
  category?: string;
  hint?: string;
  details?: FailureDetail[];
}

const CATEGORY_LABELS: Record<string, string> = {
  "anthropic-credit": "Anthropic credit",
  "anthropic-rate-limit": "Rate limit",
  "github-workflows-permission": "Workflows permission",
  "github-permission": "GitHub permission",
  auth: "Auth",
  unknown: "Unknown",
};

function categoryLabel(category?: string): string {
  if (!category) {
    return "";
  }

  return CATEGORY_LABELS[category] ?? category;
}

/**
 * Renders the structured failure metadata from a failed task_events row
 * (written by the agent's top-level catch) so a failed task can be diagnosed
 * from the UI page alone — category, remediation hint, and per-step breakdown.
 */
export default function FailurePanel({
  metadata,
  repo,
}: {
  metadata: FailureMetadata;
  repo: string;
}) {
  if (!metadata?.error && !metadata?.details?.length) {
    return null;
  }

  return (
    <div className={`spec-card ${styles.card}`}>
      <h3 className={styles.heading}>
        <span className={styles.headingLabel}>Failure</span>
        {metadata.category && (
          <span className="badge badge-red">
            {categoryLabel(metadata.category)}
          </span>
        )}
      </h3>

      {metadata.error && (
        <p className={styles.error}>
          <Linkified text={metadata.error} repo={repo} />
        </p>
      )}

      {metadata.hint && (
        <p className={`meta ${styles.hint}`}>
          <strong>How to fix:</strong>{" "}
          <Linkified text={metadata.hint} repo={repo} />
        </p>
      )}

      {metadata.details && metadata.details.length > 0 && (
        <div className={`memory-list ${styles.details}`}>
          {metadata.details.map((d, i) => (
            <div key={i} className={`version ${styles.detail}`}>
              <code className={styles.detailStep}>{d.step}</code>
              {d.category && (
                <span className={`badge badge-red ${styles.detailBadge}`}>
                  {categoryLabel(d.category)}
                </span>
              )}
              <p className={styles.detailError}>
                <Linkified text={d.error} repo={repo} />
              </p>
              {d.hint && (
                <p className={`meta ${styles.detailHint}`}>{d.hint}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
