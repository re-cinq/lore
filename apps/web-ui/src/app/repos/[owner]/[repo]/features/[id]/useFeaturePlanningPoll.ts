"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toApiResult } from "@/lib/api/result";
import type { FeaturePollPayload } from "@/lib/feature-poll";
import type { FeatureRunPayload } from "@/lib/feature-run";
import { graphIsCacheable, mergeRunGraph } from "@/lib/run-graph-cache";

/** How often the planning page asks the server what the line is doing. */
const POLL_MS = 4000;

/** Poll while wizard is on screen; failed polls keep last good payload; run graph fetched once per run via named request. */
/** One poll read. The run's graph is large and unchanging, so a cacheable one is named in the query and the server may leave it out of the response — the caller merges its held copy back in. */
async function fetchPoll(
  target: { owner: string; repo: string; featureId: string },
  cached: FeatureRunPayload | null,
): Promise<
  ReturnType<typeof toApiResult<FeaturePollPayload>> extends Promise<infer R>
    ? R
    : never
> {
  const query =
    cached && graphIsCacheable(cached)
      ? `?graph=${encodeURIComponent(cached.id)}`
      : "";

  return await toApiResult<FeaturePollPayload>(
    await fetch(
      `/api/repos/${target.owner}/${target.repo}/features/${target.featureId}${query}`,
      { signal: AbortSignal.timeout(15_000), cache: "no-store" },
    ),
  );
}

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
    const result = await fetchPoll({ owner, repo, featureId }, held.current);

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
