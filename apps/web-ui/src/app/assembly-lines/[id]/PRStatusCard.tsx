"use client";
import { useCallback, useEffect, useState } from "react";
import Icon from "@/components/Icon";
import styles from "./PRStatusCard.module.css";

const TERMINAL_STATES = new Set<PRStatus>(["merged", "closed"]);
const POLL_INTERVAL_MS = 15_000;

type PRStatus =
  | "draft"
  | "open"
  | "checks-failing"
  | "changes-requested"
  | "approved"
  | "merged"
  | "closed";

interface PRDetails {
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

export default function PRStatusCard({
  taskId,
  prUrl,
}: {
  taskId: string;
  prUrl: string;
}) {
  const [details, setDetails] = useState<PRDetails | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = useCallback(() => {
    fetch(`/api/assembly-lines/${taskId}/pr-status`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) setError(data.error);
        else {
          setDetails(data);
          setError(null);
        }
      })
      .catch(() => setError("Status unavailable"));
  }, [taskId]);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  // Poll while the PR is live. Merged/closed and error are both terminal:
  // without the error stop, a persistently failing endpoint (deleted PR,
  // rate limit) would be re-fetched every 15s for the tab's lifetime.
  const isTerminal = details
    ? TERMINAL_STATES.has(details.computed_status)
    : false;
  useEffect(() => {
    if (isTerminal || error) return;
    const handle = setInterval(fetchStatus, POLL_INTERVAL_MS);
    return () => clearInterval(handle);
  }, [fetchStatus, isTerminal, error]);

  // A failed poll must not wipe already-loaded details off the screen.
  if (error && !details) {
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

  const color = STATUS_COLORS[details.computed_status] || "var(--text-muted)";
  const passingChecks = details.checks.filter(
    (c) => c.conclusion === "success" || c.conclusion === "skipped",
  ).length;
  const failingChecks = details.checks.filter(
    (c) => c.conclusion === "failure" || c.conclusion === "timed_out",
  ).length;
  const pendingChecks = details.checks.filter(
    (c) => c.status !== "completed",
  ).length;
  const approvals = details.reviews.filter((r) => r.state === "APPROVED");
  const changesRequested = details.reviews.filter(
    (r) => r.state === "CHANGES_REQUESTED",
  );

  return (
    <div className={`spec-card ${styles.card}`}>
      <div className={styles.statusRow}>
        <strong>PR Status:</strong>
        <span
          className={`status-pill ${styles.pill}`}
          style={{ ["--pill-color" as string]: color }}
        >
          {details.computed_status}
        </span>
        <a href={details.html_url} target="_blank" className={styles.titleLink}>
          #{details.number} {details.title}
        </a>
      </div>

      {details.checks.length > 0 && (
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
      )}

      {(approvals.length > 0 || changesRequested.length > 0) && (
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
              Changes requested by{" "}
              {changesRequested.map((r) => r.user).join(", ")}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
