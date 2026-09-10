import type { ReactNode } from "react";
import RunningCard from "./RunningCard";
import SpecPrCard from "./SpecPrCard";
import DecompositionProgressCard from "./DecompositionProgressCard";
import { isPlanningActive } from "@/lib/feature-status";
import { featurePhaseOf } from "@/lib/feature-phase";
import type { FeaturePollPayload } from "@/lib/feature-poll";

/** What both phase renderers read: where the line is, what it is saying, and how long the current step has. */
interface PhaseInput {
  phase: ReturnType<typeof featurePhaseOf>;
  poll: FeaturePollPayload;
  iteration: number;
  timeoutMinutes: number;
  finalizing: boolean;
  latestCreatedAt: string | undefined;
}

/** What the machine is doing, if anything: the finished view, the parked spec PR, the decompose progress, or the running card. */
export function phaseView(
  props: PhaseInput & { settledView: ReactNode },
): ReactNode {
  const { phase, poll } = props;

  if (isFeatureSettled(phase, poll.feature.status)) {
    return <>{props.settledView}</>;
  }

  // Spec PR open, line parked on `merged`: waiting on a PERSON, not on the machine.
  if (phase.kind === "awaiting-merge") {
    return <SpecPrCard feature={poll.feature} />;
  }

  // The merge resumed the line: decompose breaks the spec down, or the issues station files the results.
  if (phase.kind === "decomposing") {
    return <DecomposeCard phase={phase} />;
  }

  return runningPhaseCard(props);
}

/** Gated on the FEATURE as well as the line: a legacy feature mints one line per round, which reports `done` while the author still has a decision to make. */
function isFeatureSettled(
  phase: ReturnType<typeof featurePhaseOf>,
  featureStatus: FeaturePollPayload["feature"]["status"],
): boolean {
  return phase.kind === "done" && !isPlanningActive(featureStatus);
}

/** Same card as a planning round: same line, and the author has no decision to make while it runs. Returns null when the line wants nothing said and the author's analysis view takes over. */
function runningPhaseCard(props: PhaseInput): ReactNode {
  const { phase, poll, finalizing } = props;
  const { working, showSpec } = runningPhase(phase, {
    finalizing,
    runStatus: poll.run?.status ?? "running",
  });

  if (!working && !showSpec) {
    return null;
  }

  return <PhaseRunningCard {...props} showSpec={showSpec} />;
}

/** Decompose progress. The iteration shown is the decompose NODE's attempt — a correction round — not the count of planning rounds that ran before the PR, which would read as though planning had restarted. */
function DecomposeCard({
  phase,
}: {
  phase: Extract<ReturnType<typeof featurePhaseOf>, { kind: "decomposing" }>;
}) {
  return (
    <DecompositionProgressCard
      nodeId={phase.nodeId}
      since={phase.since}
      iteration={phase.nodeIteration}
    />
  );
}

/** Whether the line is doing round or spec work, and whether the running card should read "spec". `finalizing` bridges only until the first poll shows the line moving; a line that ends without a PR must give the controls back. */
function runningPhase(
  phase: ReturnType<typeof featurePhaseOf>,
  line: { finalizing: boolean; runStatus: string },
) {
  return {
    working: phase.kind === "planning" || phase.kind === "writing-spec",
    showSpec:
      phase.kind === "writing-spec" ||
      (line.finalizing && line.runStatus === "running"),
  };
}

/** The running card, wired to the working NODE: its start, its deadline, and its live output. */
function PhaseRunningCard(props: PhaseInput & { showSpec: boolean }) {
  const { phase, poll, showSpec } = props;

  return (
    <RunningCard
      iteration={props.iteration}
      since={runningCardSince(phase, props.latestCreatedAt)}
      timeoutMinutes={props.timeoutMinutes}
      nodeId={runningCardNodeId(phase)}
      liveOutput={poll.liveOutput}
      run={poll.run}
      phase={showSpec ? "spec" : "round"}
    />
  );
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
