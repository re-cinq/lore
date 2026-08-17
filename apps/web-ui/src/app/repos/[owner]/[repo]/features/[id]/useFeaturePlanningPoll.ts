"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toApiResult } from "@/lib/api/result";
import type { FeaturePollPayload } from "@/lib/feature-poll";
import type { FeatureRunPayload } from "@/lib/feature-run";
import { graphIsCacheable, mergeRunGraph } from "@/lib/run-graph-cache";

/** How often the planning page asks the server what the line is doing. */
const POLL_MS = 4000;

/**
 * The planning wizard's poll, as a hook.
 *
 * It polls while the WIZARD is on screen, not only while a planning round runs.
 * The spec phase runs no round, so an "is a round active" guard stopped polling
 * exactly when the line was working — and since the server-rendered seed carries
 * no `run`, a RELOAD mid-phase showed the decision row, offered the button again,
 * and never learned otherwise. Pressing it then mints a second line, which is how
 * one feature collected seven branches. The wizard only renders while planning is
 * unfinished, so polling for as long as it is mounted costs one GET per interval
 * on one page.
 *
 * A failed poll keeps the last good payload: a 500 or a dropped connection is not
 * news about the feature, and blanking the page on one bad tick would be worse
 * than showing state that is four seconds old.
 *
 * The run GRAPH is fetched once per run, not once per tick. It is a clone of the
 * blueprint, stamped at start and never edited (FR6.38), so re-downloading it every
 * four seconds for the life of a planning round is pure waste next to the nodes and
 * tokens that actually change. The request names the run whose graph it holds and
 * the server omits that one; `mergeRunGraph` puts it back. Naming the RUN rather
 * than sending a bare flag is what makes a retry — a new run, a new clone — fetch
 * its own graph instead of inheriting the previous one.
 */
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
  const [data, setData] = useState<FeaturePollPayload>(initial);

  // The run whose graph is in hand, read through a ref so `refresh` keeps a stable
  // identity: it is the polling effect's only dependency, and re-creating it each
  // tick would tear down and restart the interval on every poll. Written in an
  // effect rather than during render — a ref touched while rendering is not safe
  // under concurrent React.
  const held = useRef<FeatureRunPayload | null>(null);

  useEffect(() => {
    held.current = data.run ?? null;
  }, [data.run]);

  const refresh = useCallback(async (): Promise<FeaturePollPayload | null> => {
    const cached = held.current;
    const query =
      cached && graphIsCacheable(cached)
        ? `?graph=${encodeURIComponent(cached.id)}`
        : "";
    const result = await toApiResult<FeaturePollPayload>(
      await fetch(`/api/repos/${owner}/${repo}/features/${featureId}${query}`, {
        cache: "no-store",
      }),
    );

    if (result.status !== "ok") {
      return null;
    }
    const fresh = result.data;

    // Merged through the functional update so the graph is folded into whatever
    // the CURRENT payload holds, not into a snapshot this closure captured.
    setData((previous) =>
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

  return { data, refresh };
}
