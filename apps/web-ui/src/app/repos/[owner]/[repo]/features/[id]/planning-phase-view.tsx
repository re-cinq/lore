import type { ReactNode } from "react";
import RunningCard from "./RunningCard";
import SpecPrCard from "./SpecPrCard";
import DecompositionProgressCard from "./DecompositionProgressCard";
import { isPlanningActive } from "../feature-status";
import { featurePhaseOf } from "@/lib/feature-phase";
import type { FeaturePollPayload } from "@/lib/feature-poll";

/** Gated on the FEATURE as well as the line: a legacy feature mints one line per round, which reports `done` while the author still has a decision to make. */
function isFeatureSettled(
  phase: ReturnType<typeof featurePhaseOf>,
  featureStatus: FeaturePollPayload["feature"]["status"],
): boolean {
  return phase.kind === "done" && !isPlanningActive(featureStatus);
}

/** Whether the line is doing round or spec work, and whether the running card should read "spec". `finalizing` bridges only until the first poll shows the line moving; a line that ends without a PR must give the controls back. */
function runningPhase(
  phase: ReturnType<typeof featurePhaseOf>,
  finalizing: boolean,
  runStatus: string,
) {
  return {
    working: phase.kind === "planning" || phase.kind === "writing-spec",
    showSpec:
      phase.kind === "writing-spec" || (finalizing && runStatus === "running"),
  };
}

/** The working NODE's start, not the round's, or a late spec node reads as over budget. */
function runningCardSince(
  phase: ReturnType<typeof featurePhaseOf>,
  latestCreatedAt: string | undefined,
): string | undefined {
  return "since" in phase ? (phase.since ?? latestCreatedAt) : undefined;
}

/** Counts against THAT node's kill deadline, not the round's unenforced budget. */
function runningCardNodeId(
  phase: ReturnType<typeof featurePhaseOf>,
): string | undefined {
  return "nodeId" in phase ? phase.nodeId : undefined;
}

/** Same card as a planning round: same line, and the author has no decision to make while it runs. Returns null when the line wants nothing said and the author's analysis view takes over. */
function runningPhaseCard({
  phase,
  poll,
  iteration,
  timeoutMinutes,
  finalizing,
  latestCreatedAt,
}: {
  phase: ReturnType<typeof featurePhaseOf>;
  poll: FeaturePollPayload;
  iteration: number;
  timeoutMinutes: number;
  finalizing: boolean;
  latestCreatedAt: string | undefined;
}): ReactNode {
  const { working, showSpec } = runningPhase(
    phase,
    finalizing,
    poll.run?.status ?? "running",
  );

  if (!working && !showSpec) {
    return null;
  }

  return (
    <RunningCard
      iteration={iteration}
      since={runningCardSince(phase, latestCreatedAt)}
      timeoutMinutes={timeoutMinutes}
      nodeId={runningCardNodeId(phase)}
      liveOutput={poll.liveOutput}
      run={poll.run}
      phase={showSpec ? "spec" : "round"}
    />
  );
}

/** What the machine is doing, if anything: the finished view, the parked spec PR, the decompose progress, or the running card. */
export function phaseView({
  phase,
  poll,
  settledView,
  iteration,
  timeoutMinutes,
  finalizing,
  latestCreatedAt,
}: {
  phase: ReturnType<typeof featurePhaseOf>;
  poll: FeaturePollPayload;
  settledView: ReactNode;
  iteration: number;
  timeoutMinutes: number;
  finalizing: boolean;
  latestCreatedAt: string | undefined;
}): ReactNode {
  if (isFeatureSettled(phase, poll.feature.status)) {
    return <>{settledView}</>;
  }

  // Spec PR open, line parked on `merged`, waiting on a PERSON, not the machine.
  if (phase.kind === "awaiting-merge") {
    return <SpecPrCard feature={poll.feature} />;
  }

  // Merge resumed the line: decompose breaks spec down or issues station files results.
  if (phase.kind === "decomposing") {
    return (
      <DecompositionProgressCard
        nodeId={phase.nodeId}
        since={phase.since}
        // Decompose node's attempt (correction round), not count of pre-PR planning rounds.
        iteration={phase.nodeIteration}
      />
    );
  }

  return runningPhaseCard({
    phase,
    poll,
    iteration,
    timeoutMinutes,
    finalizing,
    latestCreatedAt,
  });
}
