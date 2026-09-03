"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toApiResult } from "@/lib/api/result";
import type { FeaturePollPayload } from "@/lib/feature-poll";
import type { FeatureRunPayload } from "@/lib/feature-run";
import { graphIsCacheable, mergeRunGraph } from "@/lib/run-graph-cache";

/** How often the planning page asks the server what the line is doing. */
const POLL_MS = 4000;

/** Poll while wizard is on screen; failed polls keep last good payload; run graph fetched once per run via named request. */
export function useFeaturePlanningPoll({
  owner,
  repo,
  featureId,
  initial,
}: {
  owner: string;
  repo: string;
  featureId: string;
  initial: FeaturePollPayload;
}): {
  data: FeaturePollPayload;
  refresh: () => Promise<FeaturePollPayload | null>;
} {
  const [payload, setPayload] = useState<FeaturePollPayload>(initial);

  // Run's graph in hand via ref so `refresh` keeps stable identity; written in effect for concurrent React safety.
  const held = useRef<FeatureRunPayload | null>(null);

  useEffect(() => {
    held.current = payload.run ?? null;
  }, [payload.run]);

  const refresh = useCallback(async (): Promise<FeaturePollPayload | null> => {
    const cached = held.current;
    const query =
      cached && graphIsCacheable(cached)
        ? `?graph=${encodeURIComponent(cached.id)}`
        : "";
    const result = await toApiResult<FeaturePollPayload>(
      await fetch(`/api/repos/${owner}/${repo}/features/${featureId}${query}`, {
        signal: AbortSignal.timeout(15_000),
        cache: "no-store",
      }),
    );

    if (result.status !== "ok") {
      return null;
    }
    const fresh = result.data;

    // Functional update folds graph into current payload, not snapshot this closure captured.
    setPayload((previous) =>
      fresh.run
        ? { ...fresh, run: mergeRunGraph(previous.run ?? null, fresh.run) }
        : fresh,
    );

    return fresh.run
      ? { ...fresh, run: mergeRunGraph(held.current, fresh.run) }
      : fresh;
  }, [owner, repo, featureId]);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), POLL_MS);

    return () => clearInterval(timer);
  }, [refresh]);

  return { data: payload, refresh };
}
