"use client";

import { useEffect, useRef, useState, type ComponentProps } from "react";
import type { PlanActions, PlanSocket } from "./plan-actions";
import PlanDetailView from "./PlanDetailView";
import { usePlanRunChannel } from "./usePlanRunChannel";

type ViewProps = ComponentProps<typeof PlanDetailView>;

type PlanDetailLiveProps = Omit<ViewProps, "run" | "runState" | "retryRun"> & {
  /** The tokens the server minted as it rendered, so the first connect of each channel needs no round trip; null when there were none to mint. */
  collabSocket: PlanSocket | null;
  planRunToken: string | null;
  mintPlanRunToken: () => Promise<{ token: string } | { error: string }>;
};

/** The plan page on the client: its run followed over the `plan-run` channel, and the editor's first connect made with the socket the server already opened. */
export default function PlanDetailLive(props: PlanDetailLiveProps) {
  const { collabSocket, planRunToken, mintPlanRunToken, openSocket, ...rest } =
    props;
  const channel = usePlanRunChannel(
    rest.meta.id,
    planRunToken,
    mintPlanRunToken,
  );
  const openPlanSocket = useFirstThen(collabSocket, openSocket);

  return (
    <PlanDetailView
      {...rest}
      openSocket={openPlanSocket}
      run={channel.run}
      runState={channel.state}
      retryRun={channel.retry}
    />
  );
}

/** Answers `first` once, then asks `next` every time after: a reconnect needs a fresh token, never the one the page rendered with. */
function useFirstThen(
  first: PlanSocket | null,
  next: PlanActions["openSocket"],
): PlanActions["openSocket"] {
  const latest = useRef(next);

  useEffect(() => {
    latest.current = next;
  });
  const [openOnce] = useState(() => {
    let unused = first;

    return async () => {
      const socket = unused;

      unused = null;

      return socket ?? latest.current();
    };
  });

  return openOnce;
}
