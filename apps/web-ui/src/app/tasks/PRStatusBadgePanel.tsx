"use client";
import { useEffect, useState } from "react";
import PRStatusBadge from "./PRStatusBadge";

/**
 * Client container for PRStatusBadge — polls the PR status once on mount and
 * hands the resolved status down to the pure badge (data down, actions up).
 */
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
