"use client";
import { useCallback, useEffect, useState } from "react";
import PRStatusCard, { type PRDetails, type PRStatus } from "./PRStatusCard";
import { useCoordinatedRefresh } from "./TaskRefreshProvider";

const TERMINAL_STATES = new Set<PRStatus>(["merged", "closed"]);

/** The PR's status, or the reason there isn't one. Returns the outcome rather than setting state, so the one place that decides what the panel shows is the panel itself — and an unreachable route and a route that answered with an error land in the same shape. */
async function fetchPrStatus(
  taskId: string,
): Promise<{ details: PRDetails | null; error: string | null }> {
  try {
    const res = await fetch(`/api/tasks/${taskId}/pr-status`, {
      signal: AbortSignal.timeout(15_000),
    });
    const prStatus = (await res.json()) as PRDetails & { error?: string };

    return prStatus.error
      ? { details: null, error: prStatus.error }
      : { details: prStatus, error: null };
  } catch {
    return { details: null, error: "Status unavailable" };
  }
}

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
    void fetchPrStatus(taskId).then((outcome) => {
      setError(outcome.error);

      // A failed poll must not wipe already-loaded details off the screen.
      if (outcome.details) {
        setDetails(outcome.details);
      }
    });
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
