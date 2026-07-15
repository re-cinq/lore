"use client";
import { useCallback, useEffect, useState } from "react";
import PRStatusCard, { type PRDetails, type PRStatus } from "./PRStatusCard";

const TERMINAL_STATES = new Set<PRStatus>(["merged", "closed"]);
const POLL_INTERVAL_MS = 15_000;

/**
 * Client container for PRStatusCard — polls the PR status on mount and while the
 * PR is live, threading the resolved details / error down to the pure card.
 */
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
    fetch(`/api/tasks/${taskId}/pr-status`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) {
          setError(data.error);
        } else {
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
    if (isTerminal || error) {
      return;
    }
    const handle = setInterval(fetchStatus, POLL_INTERVAL_MS);

    return () => clearInterval(handle);
  }, [fetchStatus, isTerminal, error]);

  return <PRStatusCard details={details} error={error} prUrl={prUrl} />;
}
