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

function categoryLabel(category: string): string {
  return CATEGORY_LABELS[category] ?? category;
}

function hasFailureContent(metadata: FailureMetadata): boolean {
  return Boolean(metadata?.error) || Boolean(metadata?.details?.length);
}

function FailureCategoryBadge({ category }: { category?: string }) {
  return category ? (
    <span className="badge badge-red">{categoryLabel(category)}</span>
  ) : null;
}

function FailureHint({ hint, repo }: { hint?: string; repo: string }) {
  if (!hint) {
    return null;
  }

  return (
    <p className={`meta ${styles.hint}`}>
      <strong>How to fix:</strong> <Linkified text={hint} repo={repo} />
    </p>
  );
}

function FailureDetailRow({
  detail,
  repo,
}: {
  detail: FailureDetail;
  repo: string;
}) {
  return (
    <div className={`version ${styles.detail}`}>
      <code className={styles.detailStep}>{detail.step}</code>
      {detail.category && (
        <span className={`badge badge-red ${styles.detailBadge}`}>
          {categoryLabel(detail.category)}
        </span>
      )}
      <p className={styles.detailError}>
        <Linkified text={detail.error} repo={repo} />
      </p>
      {detail.hint && (
        <p className={`meta ${styles.detailHint}`}>{detail.hint}</p>
      )}
    </div>
  );
}

/** Renders structured failure metadata for diagnosis: category, hint, per-step breakdown. */
export default function FailurePanel({
  metadata,
  repo,
}: {
  metadata: FailureMetadata;
  repo: string;
}) {
  if (!hasFailureContent(metadata)) {
    return null;
  }

  const details = metadata.details ?? [];

  return (
    <div className={`spec-card ${styles.card}`}>
      <h3 className={styles.heading}>
        <span className={styles.headingLabel}>Failure</span>
        <FailureCategoryBadge category={metadata.category} />
      </h3>

      {metadata.error && (
        <p className={styles.error}>
          <Linkified text={metadata.error} repo={repo} />
        </p>
      )}

      <FailureHint hint={metadata.hint} repo={repo} />

      {details.length > 0 && (
        <div className={`memory-list ${styles.details}`}>
          {details.map((d, i) => (
            <FailureDetailRow key={i} detail={d} repo={repo} />
          ))}
        </div>
      )}
    </div>
  );
}
