"use client";
import { useCallback, useEffect, useState } from "react";
import PRStatusCard, { type PRDetails, type PRStatus } from "./PRStatusCard";
import { useCoordinatedRefresh } from "./TaskRefreshProvider";

const TERMINAL_STATES = new Set<PRStatus>(["merged", "closed"]);

/** Container: fetch on mount, re-fetch on coordinator ticks, thread details to Card. */
export default function PRStatusPanel({
  taskId,
  prUrl,
}: {
  taskId: string;
  prUrl: string;
}) {
  const [details, setDetails] = useState<PRDetails | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = useCallback(() => {
    fetch(`/api/tasks/${taskId}/pr-status`, {
      signal: AbortSignal.timeout(15_000),
    })
      .then((r) => r.json())
      .then((prStatus) => {
        if (prStatus.error) {
          setError(prStatus.error);

          return;
        }
        setDetails(prStatus);
        setError(null);
      })
      .catch(() => setError("Status unavailable"));
  }, [taskId]);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  // Merged/closed and error are both terminal; prevent eternal re-fetch of deleted/rate-limited PRs
  const isTerminal = details
    ? TERMINAL_STATES.has(details.computed_status)
    : false;

  useCoordinatedRefresh(fetchStatus, !isTerminal && !error);

  return <PRStatusCard details={details} error={error} prUrl={prUrl} />;
}
