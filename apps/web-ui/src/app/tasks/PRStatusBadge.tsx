"use client";
import { useEffect, useState } from "react";

const STATUS_COLORS: Record<string, string> = {
  draft: "var(--text-muted)",
  open: "var(--info)",
  "checks-failing": "var(--danger)",
  "changes-requested": "var(--warning)",
  approved: "var(--success)",
  merged: "var(--accent)",
  closed: "var(--border-hover)",
};

export default function PRStatusBadge({ taskId }: { taskId: string }) {
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/tasks/${taskId}/pr-status`)
      .then((r) => r.json())
      .then((data) => {
        if (data.computed_status) {
          setStatus(data.computed_status);
        }
      })
      .catch(() => {
        /* silent */
      });
  }, [taskId]);

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
