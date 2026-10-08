"use client";

import { useEffect, useReducer, useState } from "react";
import { useRunChannel } from "@/app/assembly-runs/[id]/useRunChannel";
import {
  initialPlanRunLive,
  reducePlanRunLive,
  type PlanRunLiveAction,
  type PlanRunLiveFacts,
} from "@/lib/plan-run-live-reducer";
import { useDebouncedCallback } from "@/lib/use-debounced-callback";
import type { RunStreamFrame } from "@/lib/run-stream-types";
import type { PlanActions } from "./plan-actions";
import type { PlanRun } from "./PlanRunCard";

const OPEN_RUN: ReadonlySet<string> = new Set(["queued", "running"]);

// One re-fetch per burst: a reopen replays every node's snapshot at once, and a settling node fires two frames back to back.
const SETTLE_MS = 300;

const EMPTY_RUN_FACTS: PlanRunLiveFacts = {
  status: "queued",
  outcome: null,
  reason: null,
};

/** Follows the plan's run on the tab's live socket, with no `router.refresh()`. A seed the server re-rendered with (Approve, Regenerate, …) outranks whatever the socket folded in from the run it already reflects, so a changed seed resets the fold. */
export function usePlanRunLive(
  seed: PlanRun | null,
  refreshRunFacts: PlanActions["refreshRunFacts"],
): PlanRun | null {
  const [live, dispatch] = useReducer(reducePlanRunLive, seed, (run) =>
    initialPlanRunLive(run ?? EMPTY_RUN_FACTS, run?.nodes ?? []),
  );
  const [facts, setFacts] = useState(seed);

  useEffect(() => adoptSeed(seed, dispatch, setFacts), [seed, dispatch]);
  const scheduleFactsRefresh = useDebouncedCallback(
    () => void refreshFacts(refreshRunFacts, setFacts),
    SETTLE_MS,
  );

  useRunChannel(channelOptions(seed, dispatch, scheduleFactsRefresh));

  return facts && { ...facts, ...live.run, nodes: live.nodes };
}

function adoptSeed(
  seed: PlanRun | null,
  dispatch: (action: PlanRunLiveAction) => void,
  setFacts: (run: PlanRun | null) => void,
): void {
  setFacts(seed);
  dispatch({
    type: "reset",
    run: seed ?? EMPTY_RUN_FACTS,
    nodes: seed?.nodes ?? [],
  });
}

function channelOptions(
  seed: PlanRun | null,
  dispatch: (frame: RunStreamFrame) => void,
  scheduleFactsRefresh: () => void,
) {
  return {
    runId: seed?.id ?? "",
    afterId: "0",
    enabled: seed !== null && OPEN_RUN.has(seed.status),
    onFrame: (frame: RunStreamFrame) =>
      onFrame(frame, dispatch, scheduleFactsRefresh),
    onConnectionChange: () => undefined,
  };
}

function onFrame(
  frame: RunStreamFrame,
  dispatch: (frame: RunStreamFrame) => void,
  scheduleFactsRefresh: () => void,
): void {
  dispatch(frame);

  if (settles(frame)) {
    scheduleFactsRefresh();
  }
}

async function refreshFacts(
  refreshRunFacts: PlanActions["refreshRunFacts"],
  setFacts: (run: PlanRun | null) => void,
): Promise<void> {
  const result = await refreshRunFacts();

  if ("run" in result) {
    setFacts(result.run);
  }
}

// A node that settles, or any run_status change, is the only moment the GitHub/args-derived facts can have moved.
function settles(frame: RunStreamFrame): boolean {
  if (frame.type === "run_status") {
    return true;
  }

  return frame.type === "node_status" && frame.node.outcome !== null;
}
