const STATUS_COLORS: Record<string, string> = {
  draft: "var(--text-muted)",
  open: "var(--info)",
  "checks-failing": "var(--danger)",
  "changes-requested": "var(--warning)",
  approved: "var(--success)",
  merged: "var(--accent)",
  closed: "var(--border-hover)",
};

/**
 * Pure PR-status pill. Presentational (data down): the polling lives in
 * PRStatusBadgePanel, which threads the resolved status in as a prop.
 */
export default function PRStatusBadge({ status }: { status: string | null }) {
  if (!status) {
    return null;
  }

  return (
    <span
      className="status-pill"
      style={{
        ["--pill-color" as string]:
          STATUS_COLORS[status] || "var(--text-muted)",
      }}
    >
      {status}
    </span>
  );
}
