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

export interface FailurePanelProps {
  metadata: FailureMetadata | undefined;
  repo: string;
}

/** Renders structured failure metadata for diagnosis: category, hint, per-step breakdown. */
export default function FailurePanel({ metadata, repo }: FailurePanelProps) {
  if (!hasFailureContent(metadata)) {
    return null;
  }

  const safe = metadata ?? {};

  return (
    <div className={`spec-card ${styles.card}`}>
      <h3 className={styles.heading}>
        <span className={styles.headingLabel}>Failure</span>
        <FailureCategoryBadge category={safe.category} />
      </h3>

      {safe.error && <FailureSummary error={safe.error} repo={repo} />}

      <FailureHint hint={safe.hint} repo={repo} />
      <FailureDetails details={safe.details ?? []} repo={repo} />
    </div>
  );
}

function hasFailureContent(metadata: FailureMetadata | undefined): boolean {
  return Boolean(metadata?.error) || Boolean(metadata?.details?.length);
}

function FailureCategoryBadge({ category }: { category?: string }) {
  return category ? (
    <span className="badge badge-red">{categoryLabel(category)}</span>
  ) : null;
}

function FailureSummary({ error, repo }: { error: string; repo: string }) {
  return (
    <p className={styles.error}>
      <Linkified text={error} repo={repo} />
    </p>
  );
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

/** The per-step breakdown, when there is one. Many failures carry only a category and a message — the list renders nothing rather than an empty frame the reader would read as missing detail. */
function FailureDetails({
  details,
  repo,
}: {
  details: NonNullable<FailureMetadata["details"]>;
  repo: string;
}) {
  if (details.length === 0) {
    return null;
  }

  return (
    <div className={`memory-list ${styles.details}`}>
      {details.map((d, i) => (
        <FailureDetailRow key={i} detail={d} repo={repo} />
      ))}
    </div>
  );
}

interface FailureDetailRowProps {
  detail: FailureDetail;
  repo: string;
}

function FailureDetailRow({ detail, repo }: FailureDetailRowProps) {
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
