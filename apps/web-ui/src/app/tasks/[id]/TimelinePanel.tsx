"use client";

import { useCallback, useEffect, useState } from "react";
import TimelineView, { type TimelineResponse } from "./TimelineView";

const ACTIVE_STATES = new Set(["pending", "running", "queued", "review"]);
const POLL_INTERVAL_MS = 10_000;

/**
 * Client container for TimelineView — polls the stage timeline on mount and
 * while a non-terminal stage is in flight, threading data / loading / error
 * down to the pure view.
 */
export default function TimelinePanel({
  taskId,
  initialStatus,
}: {
  taskId: string;
  initialStatus: string;
}) {
  const [data, setData] = useState<TimelineResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchTimeline = useCallback(async () => {
    try {
      const r = await fetch(`/api/tasks/${taskId}/timeline`);

      if (!r.ok) {
        setError(`HTTP ${r.status}`);
        setLoading(false);

        return;
      }
      const json = (await r.json()) as TimelineResponse;

      setData(json);
      setError(null);
      setLoading(false);
    } catch (err) {
      setError((err as Error).message);
      setLoading(false);
    }
  }, [taskId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data fetch on mount; state is set inside the async fetch
    void fetchTimeline();
    // Once we have data, the fetched timeline is authoritative — poll only while a
    // non-terminal stage is in flight (and the PR isn't merged/closed). Basing this
    // on the LATCHED initialStatus (as before) short-circuited the OR and polled
    // forever; now the response can actually turn it off. Before the first fetch,
    // fall back to the initial status.
    const stillActive = data
      ? Boolean(data.current_stage) &&
        data.current_stage !== "retrospective" &&
        data.current_stage !== "done" &&
        data.pr_state !== "merged" &&
        data.pr_state !== "closed"
      : ACTIVE_STATES.has(initialStatus);

    if (!stillActive) {
      return;
    }
    const handle = setInterval(() => void fetchTimeline(), POLL_INTERVAL_MS);

    return () => clearInterval(handle);
  }, [fetchTimeline, initialStatus, data?.current_stage]);

  return <TimelineView data={data} loading={loading} error={error} />;
}
