"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Dispatch, RefObject, SetStateAction } from "react";
import { toApiResult } from "@/lib/api/result";
import type { FeaturePollPayload } from "@/lib/feature-poll";
import type { FeatureRunPayload } from "@/lib/feature-run";
import { graphIsCacheable, mergeRunGraph } from "@/lib/run-graph-cache";

/** How often the planning page asks the server what the line is doing. */
const POLL_MS = 4000;

interface PollInput {
  owner: string;
  repo: string;
  featureId: string;
  initial: FeaturePollPayload;
}

interface PollHandle {
  data: FeaturePollPayload;
  /** Polls immediately and returns the merged payload, so a caller that just submitted can act on the result without waiting for the next tick. */
  refresh: () => Promise<FeaturePollPayload | null>;
}

/** Poll while wizard is on screen; failed polls keep last good payload; run graph fetched once per run via named request. */
export function useFeaturePlanningPoll(input: PollInput): PollHandle {
  const [payload, setPayload] = useState<FeaturePollPayload>(input.initial);

  // Run's graph in hand via ref so `refresh` keeps stable identity; written in effect for concurrent React safety.
  const held = useRef<FeatureRunPayload | null>(null);

  useEffect(() => {
    held.current = payload.run ?? null;
  }, [payload.run]);

  const refresh = usePollRefresh(input, held, setPayload);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), POLL_MS);

    return () => clearInterval(timer);
  }, [refresh]);

  return { data: payload, refresh };
}

/** One poll, folded into state and handed back to the caller. Identity is stable across renders so the interval below is not torn down on every payload. */
function usePollRefresh(
  target: PollInput,
  held: RefObject<FeatureRunPayload | null>,
  setPayload: Dispatch<SetStateAction<FeaturePollPayload>>,
) {
  const { owner, repo, featureId } = target;

  return useCallback(async (): Promise<FeaturePollPayload | null> => {
    const result = await fetchPoll({ owner, repo, featureId }, held.current);

    if (result.status !== "ok") {
      return null;
    }
    const fresh = result.data;

    // Functional update, so the graph folds into the CURRENT payload rather than the snapshot this closure captured.
    setPayload((previous) => withMergedGraph(previous.run ?? null, fresh));

    return withMergedGraph(held.current, fresh);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the ref and the state setter are stable for the component's lifetime.
  }, [owner, repo, featureId]);
}

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

/** The fresh payload with its run graph folded onto the one already held. A poll returns only what changed, so replacing the graph outright would drop the nodes the previous response established. */
function withMergedGraph(
  heldRun: FeatureRunPayload | null,
  fresh: FeaturePollPayload,
): FeaturePollPayload {
  return fresh.run
    ? { ...fresh, run: mergeRunGraph(heldRun, fresh.run) }
    : fresh;
}
