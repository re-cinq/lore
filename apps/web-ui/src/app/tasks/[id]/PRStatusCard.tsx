import Icon from "@/components/Icon";
import styles from "./PRStatusCard.module.css";

export type PRStatus =
  | "draft"
  | "open"
  | "checks-failing"
  | "changes-requested"
  | "approved"
  | "merged"
  | "closed";

export interface PRDetails {
  number: number;
  title: string;
  state: string;
  draft: boolean;
  merged: boolean;
  mergeable: boolean | null;
  html_url: string;
  checks: Array<{ name: string; status: string; conclusion: string | null }>;
  reviews: Array<{ user: string; state: string; submitted_at: string }>;
  computed_status: PRStatus;
}

const STATUS_COLORS: Record<PRStatus, string> = {
  draft: "var(--text-muted)",
  open: "var(--info)",
  "checks-failing": "var(--danger)",
  "changes-requested": "var(--warning)",
  approved: "var(--success)",
  merged: "var(--accent)",
  closed: "var(--border-hover)",
};

function resolvedColor(status: PRStatus): string {
  return STATUS_COLORS[status] || "var(--text-muted)";
}

function showUnavailable(
  error: string | null,
  details: PRDetails | null,
): boolean {
  return Boolean(error) && !details;
}

function ChecksRow({ details }: { details: PRDetails }) {
  if (details.checks.length === 0) {
    return null;
  }

  const passingChecks = details.checks.filter(
    (c) => c.conclusion === "success" || c.conclusion === "skipped",
  ).length;
  const failingChecks = details.checks.filter(
    (c) => c.conclusion === "failure" || c.conclusion === "timed_out",
  ).length;
  const pendingChecks = details.checks.filter(
    (c) => c.status !== "completed",
  ).length;

  return (
    <div className={styles.checksRow}>
      <strong>Checks:</strong>{" "}
      {passingChecks > 0 && (
        <span className={styles.passing}>
          <Icon name="check" size={13} /> {passingChecks} passing
        </span>
      )}
      {failingChecks > 0 && (
        <span className={styles.failing}>
          <Icon name="error" size={13} /> {failingChecks} failing
        </span>
      )}
      {pendingChecks > 0 && (
        <span className={styles.pending}>
          <Icon name="pending" size={13} /> {pendingChecks} pending
        </span>
      )}
    </div>
  );
}

function ReviewsRow({ details }: { details: PRDetails }) {
  const approvals = details.reviews.filter((r) => r.state === "APPROVED");
  const changesRequested = details.reviews.filter(
    (r) => r.state === "CHANGES_REQUESTED",
  );

  if (approvals.length === 0 && changesRequested.length === 0) {
    return null;
  }

  return (
    <div className={styles.reviewsRow}>
      <strong>Reviews:</strong>{" "}
      {approvals.length > 0 && (
        <span className={styles.approved}>
          <Icon name="check" size={13} /> Approved by{" "}
          {approvals.map((r) => r.user).join(", ")}
        </span>
      )}
      {changesRequested.length > 0 && (
        <span className={styles.changesRequested}>
          Changes requested by {changesRequested.map((r) => r.user).join(", ")}
        </span>
      )}
    </div>
  );
}

/** Pure PR-status card; Panel owns poll, threads details/error down. */
export default function PRStatusCard({
  details,
  error,
  prUrl,
}: {
  details: PRDetails | null;
  error: string | null;
  prUrl: string;
}) {
  // A failed poll must not wipe already-loaded details off the screen.
  if (showUnavailable(error, details)) {
    return (
      <div className={`spec-card ${styles.card}`}>
        <strong>PR Status:</strong>{" "}
        <span className="meta">Status unavailable — </span>
        <a href={prUrl} target="_blank">
          View on GitHub
        </a>
      </div>
    );
  }

  if (!details) {
    return (
      <div className={`spec-card ${styles.card}`}>
        <strong>PR Status:</strong> <span className="meta">Loading…</span>
      </div>
    );
  }

  return (
    <div className={`spec-card ${styles.card}`}>
      <div className={styles.statusRow}>
        <strong>PR Status:</strong>
        <span
          className={`status-pill ${styles.pill}`}
          style={{
            ["--pill-color" as string]: resolvedColor(details.computed_status),
          }}
        >
          {details.computed_status}
        </span>
        <a href={details.html_url} target="_blank" className={styles.titleLink}>
          #{details.number} {details.title}
        </a>
      </div>

      <ChecksRow details={details} />
      <ReviewsRow details={details} />
    </div>
  );
}
