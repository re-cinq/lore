import Icon from "@/components/Icon";
import type { IconName } from "@/lib/icon-map";
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

export interface PRStatusCardProps {
  details: PRDetails | null;
  error: string | null;
  prUrl: string;
}

/** Pure PR-status card; Panel owns poll, threads details/error down. */
export default function PRStatusCard({
  details,
  error,
  prUrl,
}: PRStatusCardProps) {
  // A failed poll must not wipe already-loaded details off the screen.
  if (showUnavailable(error, details)) {
    return <StatusUnavailable prUrl={prUrl} />;
  }

  if (!details) {
    return <StatusLoading />;
  }

  return (
    <div className={`spec-card ${styles.card}`}>
      <StatusRow details={details} />

      <ChecksRow details={details} />
      <ReviewsRow details={details} />
    </div>
  );
}

function showUnavailable(
  error: string | null,
  details: PRDetails | null,
): boolean {
  return Boolean(error) && !details;
}

/** The poll failed and nothing has loaded yet. Still offers the GitHub link — the PR exists and the reader can go look at it, which is more useful than an error alone. */
function StatusUnavailable({ prUrl }: { prUrl: string }) {
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

function StatusLoading() {
  return (
    <div className={`spec-card ${styles.card}`}>
      <strong>PR Status:</strong> <span className="meta">Loading…</span>
    </div>
  );
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

/** The PR at a glance: its state, its number, its title. The pill takes its colour from the computed status rather than from GitHub's own, because a PR that is open but failing is not the same thing to a reader as one that is open and green. */
function StatusRow({ details }: { details: PRDetails }) {
  return (
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
  );
}

function resolvedColor(status: PRStatus): string {
  return STATUS_COLORS[status] || "var(--text-muted)";
}

function ChecksRow({ details }: { details: PRDetails }) {
  if (details.checks.length === 0) {
    return null;
  }

  return <ChecksSummary tally={tallyChecks(details.checks)} />;
}

type ChecksTally = ReturnType<typeof tallyChecks>;

/** How many checks passed, failed, and are still running. A skipped check counts as passing: it is not a reason to hold the PR, and counting it separately would leave the reader adding up three numbers that never reach the total. */
function tallyChecks(checks: PRDetails["checks"]) {
  return {
    passingChecks: checks.filter(
      (c) => c.conclusion === "success" || c.conclusion === "skipped",
    ).length,
    failingChecks: checks.filter(
      (c) => c.conclusion === "failure" || c.conclusion === "timed_out",
    ).length,
    pendingChecks: checks.filter((c) => c.status !== "completed").length,
  };
}

function ChecksSummary({ tally }: { tally: ChecksTally }) {
  const { passingChecks, failingChecks, pendingChecks } = tally;

  return (
    <div className={styles.checksRow}>
      <strong>Checks:</strong>{" "}
      <CheckTally count={passingChecks} kind="passing" />
      <CheckTally count={failingChecks} kind="failing" />
      <CheckTally count={pendingChecks} kind="pending" />
    </div>
  );
}

const CHECK_KINDS = {
  passing: { className: styles.passing, icon: "check" as IconName },
  failing: { className: styles.failing, icon: "error" as IconName },
  pending: { className: styles.pending, icon: "pending" as IconName },
};

/** One count of checks, absent when it is zero — "0 failing" would read as a finding rather than as silence. */
function CheckTally({
  count,
  kind,
}: {
  count: number;
  kind: keyof typeof CHECK_KINDS;
}) {
  if (count === 0) {
    return null;
  }

  const { className, icon } = CHECK_KINDS[kind];

  return (
    <span className={className}>
      <Icon name={icon} size={13} /> {count} {kind}
    </span>
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
    <ReviewsSummary approvals={approvals} changesRequested={changesRequested} />
  );
}

interface ReviewsSummaryProps {
  approvals: PRDetails["reviews"];
  changesRequested: PRDetails["reviews"];
}

function ReviewsSummary({ approvals, changesRequested }: ReviewsSummaryProps) {
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
