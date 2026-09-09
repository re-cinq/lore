"use client";
import { useEffect, useState } from "react";
import PRStatusBadge from "./PRStatusBadge";

/** Container: polls PR status on mount, hands to pure Badge (data down). */
export default function PRStatusBadgePanel({ taskId }: { taskId: string }) {
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/tasks/${taskId}/pr-status`, {
      signal: AbortSignal.timeout(15_000),
    })
      .then((r) => r.json())
      .then((prStatus) => {
        if (prStatus.computed_status) {
          setStatus(prStatus.computed_status);
        }
      })
      .catch(() => {
        /* silent */
      });
  }, [taskId]);

  return <PRStatusBadge status={status} />;
}
