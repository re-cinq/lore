"use client";

import { useCallback, useEffect, useState } from "react";
import { toApiResult } from "@/lib/api/result";
import type { FeaturePollPayload } from "@/lib/feature-poll";

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

  const refresh = useCallback(async (): Promise<FeaturePollPayload | null> => {
    const result = await toApiResult<FeaturePollPayload>(
      await fetch(`/api/repos/${owner}/${repo}/features/${featureId}`, {
        cache: "no-store",
      }),
    );

    if (result.status !== "ok") {
      return null;
    }

    setData(result.data);

    return result.data;
  }, [owner, repo, featureId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data fetch on mount; state is set inside the async fetch
    void refresh();
    const timer = setInterval(() => void refresh(), POLL_MS);

    return () => clearInterval(timer);
  }, [refresh]);

  return { data, refresh };
}
