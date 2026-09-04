"use client";

import { Alert } from "@/components/Alert";
import {
  useEffect,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import styles from "./PlanningWizard.module.scss";
import { SubmitButton } from "@/components/SubmitButton";
import GapSections, {
  emptyFeedback,
  toUserAnswers,
  type FeedbackState,
} from "./GapSections";
import RunningCard from "./RunningCard";
import SpecPrCard from "./SpecPrCard";
import DecompositionProgressCard from "./DecompositionProgressCard";
import FailureBlock from "./FailureBlock";
import { isPlanningActive } from "../feature-status";
import { isRewind, lineageLabel, rewindOptions } from "@/lib/round-picker";
import { featurePhaseOf } from "@/lib/feature-phase";
import { useFeaturePlanningPoll } from "./useFeaturePlanningPoll";
import type { FeaturePollPayload } from "@/lib/feature-poll";
import type {
  FeatureWithIterations,
  SectionAnswers,
} from "@/lib/feature-types";

export default function PlanningWizard({
  owner,
  repo,
  feature,
  timeoutMinutes,
  refine,
  onFinalize,
  onCreateDraft,
  settledView,
}: {
  owner: string;
  repo: string;
  feature: FeatureWithIterations;
  timeoutMinutes: number;
  refine: (
    userAnswers: SectionAnswers,
    fromIteration?: number,
  ) => Promise<void>;
  onFinalize: (userAnswers: SectionAnswers) => Promise<void>;
  onCreateDraft: (title: string, prompt: string) => void;
  /** Parent owns it for decomposition rows; wizard decides when based on line state. */
  settledView: ReactNode;
}) {
  const { data: poll, refresh: fetchLatest } = useSeededPoll(
    owner,
    repo,
    feature,
  );
  const [feedback, setFeedback] = useState<FeedbackState>(emptyFeedback());
  /** Undefined = continue from latest. */
  const [continueFrom, setContinueFrom] = useState<number | undefined>();
  const [pending, startTransition] = useTransition();
  const [finalizing, setFinalizing] = useState(false);

  const latest = poll.latestIteration;
  // One value instead of five booleans; line says which node works; round's rows only for legacy features with no line.
  const phase = featurePhaseOf({
    run: poll.run,
    feature: poll.feature,
    latestIteration: latest,
    task: poll.task,
  });
  const { latestReady, failed } = planningRoundStatus(latest, phase);
  const { iteration, latestIterationOrNull, latestCreatedAt } = latestRoundMeta(
    latest,
    poll.feature.current_iteration,
  );

  useRefreshWhenRoundLands(latestReady, latestIterationOrNull);

  // Server-rendered feature refreshed when round lands; poll carries only latest iteration, not history.
  const rounds = rewindOptions(feature.iterations);
  const rewinding = isRewind(rounds, continueFrom);

  const { submitRefine, submitCreateSpecFile } = useRoundSubmits({
    refine,
    onFinalize,
    feedback,
    continueFrom,
    fetchLatest,
    startTransition,
    setFeedback,
    setContinueFrom,
    setFinalizing,
  });

  useRefreshWhenPlanningEnds(finalizing, poll.feature.status);

  const phaseCard = phaseView({
    phase,
    poll,
    settledView,
    iteration,
    timeoutMinutes,
    finalizing,
    latestCreatedAt,
  });

  if (phaseCard) {
    return phaseCard;
  }

  return (
    <AnalysisView
      {...analysisProps({
        poll,
        latest,
        latestReady,
        iteration,
        failed,
        pending,
        feedback,
        rounds,
        continueFrom,
        rewinding,
      })}
      handlers={{
        onChangeFeedback: setFeedback,
        onCreateDraft,
        onRefine: submitRefine,
        onCreateSpecPr: submitCreateSpecFile,
        onContinueFrom: setContinueFrom,
      }}
    />
  );
}

/** True/false plus what stage the current round is in, kept off the component's own body so its optional chains don't count against it. */
function planningRoundStatus(
  latest: ReturnType<typeof useSeededPoll>["data"]["latestIteration"],
  phase: ReturnType<typeof featurePhaseOf>,
) {
  return {
    latestReady: latest?.status === "ready" && !!latest.gap_result,
    failed: phase.kind === "failed",
  };
}

/** The round to attribute the current view to, and its timestamps — likewise pulled off the component body. */
function latestRoundMeta(
  latest: ReturnType<typeof useSeededPoll>["data"]["latestIteration"],
  featureIteration: number,
) {
  const iteration = latest?.iteration ?? featureIteration;

  return {
    iteration,
    latestIterationOrNull: latest ? iteration : null,
    latestCreatedAt: latest?.created_at,
  };
}

/** The round whose analysis to show: the latest one when it produced a result, otherwise the most recent that did — a failed refine must not hide the analysis before it. */
function resolveGap(
  latestReady: boolean,
  latest: ReturnType<typeof useSeededPoll>["data"]["latestIteration"],
  poll: ReturnType<typeof useSeededPoll>["data"],
) {
  const source = latestReady ? latest : poll.lastReady;

  return source?.gap_result ?? null;
}

function analysisProps(state: {
  poll: ReturnType<typeof useSeededPoll>["data"];
  latest: ReturnType<typeof useSeededPoll>["data"]["latestIteration"];
  latestReady: boolean;
  iteration: number;
  failed: boolean;
  pending: boolean;
  feedback: FeedbackState;
  rounds: ReturnType<typeof rewindOptions>;
  continueFrom: number | undefined;
  rewinding: boolean;
}) {
  const { poll, latest, latestReady } = state;

  return {
    iteration: state.iteration,
    failed: state.failed,
    gap: resolveGap(latestReady, latest, poll),
    failureReason: poll.task?.failure_reason,
    answers: latest?.user_answers,
    run: poll.run,
    pending: state.pending,
    feedback: state.feedback,
    rounds: state.rounds,
    continueFrom: state.continueFrom,
    rewinding: state.rewinding,
  };
}

/** Seeded from the server render so the first paint is not empty; the mount fetch adds the task, run and live output the page could not have. */
function useSeededPoll(
  owner: string,
  repo: string,
  feature: FeatureWithIterations,
) {
  return useFeaturePlanningPoll({
    owner,
    repo,
    featureId: feature.id,
    initial: {
      feature,
      latestIteration:
        feature.iterations[feature.iterations.length - 1] ?? null,
      task: null,
      liveOutput: null,
      lastReady: null,
      run: null,
    },
  });
}

/** The two ways a round ends. Both carry the same answers, because accepting drops the author's last form input otherwise. */
function useRoundSubmits(ctx: {
  refine: (
    userAnswers: SectionAnswers,
    fromIteration?: number,
  ) => Promise<void>;
  onFinalize: (userAnswers: SectionAnswers) => Promise<void>;
  feedback: FeedbackState;
  continueFrom: number | undefined;
  fetchLatest: () => Promise<unknown>;
  startTransition: (fn: () => Promise<void>) => void;
  setFeedback: (next: FeedbackState) => void;
  setContinueFrom: (next: number | undefined) => void;
  setFinalizing: (next: boolean) => void;
}) {
  const submitRefine = () =>
    ctx.startTransition(async () => {
      await ctx.refine(toUserAnswers(ctx.feedback), ctx.continueFrom);
      ctx.setFeedback(emptyFeedback());
      ctx.setContinueFrom(undefined);
      await ctx.fetchLatest();
    });
  const submitCreateSpecFile = () =>
    ctx.startTransition(async () => {
      ctx.setFinalizing(true);
      await ctx.onFinalize(toUserAnswers(ctx.feedback));
      ctx.setFeedback(emptyFeedback());
      await ctx.fetchLatest();
    });

  return { submitRefine, submitCreateSpecFile };
}

/** The draft spec renders from the SERVER's copy, so a landed round shows pre-round data until this refreshes it — once per iteration, since refresh() re-renders the parent. */
function useRefreshWhenRoundLands(
  latestReady: boolean,
  iteration: number | null,
): void {
  const router = useRouter();
  /** Iteration whose completion already triggered a server refresh. */
  const refreshedFor = useRef<number | null>(null);

  useEffect(() => {
    if (!latestReady || refreshedFor.current === iteration) {
      return;
    }

    refreshedFor.current = iteration;
    router.refresh();
  }, [latestReady, iteration, router]);
}

/** Finalize runs async with no intermediate status, so this watches the running poll's payload rather than adding a second interval of its own. */
function useRefreshWhenPlanningEnds(
  finalizing: boolean,
  featureStatus: Parameters<typeof isPlanningActive>[0],
): void {
  const router = useRouter();

  useEffect(() => {
    if (finalizing && !isPlanningActive(featureStatus)) {
      router.refresh();
    }
  }, [finalizing, featureStatus, router]);
}

/** What the author acts on between rounds: the analysis, the answer form, and the two ways forward. A failed latest round shows its banner ABOVE the preserved sections, so a fix-and-retry never costs the analysis. */
function AnalysisView({
  iteration,
  failed,
  gap,
  failureReason,
  answers,
  run,
  pending,
  feedback,
  handlers,
  rounds,
  continueFrom,
  rewinding,
}: {
  iteration: number;
  failed: boolean;
  gap: Parameters<typeof GapSections>[0]["gap"] | null | undefined;
  failureReason: Parameters<typeof FailureBlock>[0]["failureReason"];
  answers: Parameters<typeof FailureBlock>[0]["answers"];
  run: Parameters<typeof FailureBlock>[0]["run"];
  pending: boolean;
  feedback: FeedbackState;
  handlers: {
    onChangeFeedback: (next: FeedbackState) => void;
    onCreateDraft: (title: string, prompt: string) => void;
    onRefine: () => void;
    onCreateSpecPr: () => void;
    onContinueFrom: (iteration: number) => void;
  };
  rounds: ReturnType<typeof rewindOptions>;
  continueFrom: number | undefined;
  rewinding: boolean;
}) {
  const {
    onChangeFeedback,
    onCreateDraft,
    onRefine,
    onCreateSpecPr,
    onContinueFrom,
  } = handlers;
  const failureBlock = (
    <FailureBlock
      iteration={iteration}
      failureReason={failureReason}
      answers={answers}
      run={run}
      pending={pending}
      onRetry={onRefine}
    />
  );

  // No analysis ever produced: pure failure (if the latest failed) or an empty state.
  if (!gap) {
    return failed ? (
      failureBlock
    ) : (
      <div className="spec-card">
        <Alert variant="secondary">
          Planning hasn&apos;t produced an analysis yet — it will appear here
          once the first round finishes.
        </Alert>
      </div>
    );
  }

  return (
    <div>
      {failed && <div className={styles.failureSlot}>{failureBlock}</div>}
      <GapSections
        gap={gap}
        feedback={feedback}
        onChange={onChangeFeedback}
        onCreateDraft={onCreateDraft}
      />
      <RoundActions
        pending={pending}
        rounds={rounds}
        continueFrom={continueFrom}
        onRefine={onRefine}
        onCreateSpecPr={onCreateSpecPr}
        onContinueFrom={onContinueFrom}
      />
      {rewinding && (
        <p className={`meta ${styles.rewindNote}`} role="status">
          This round continues round {continueFrom} — rounds after it stay on
          record but are not carried forward.
        </p>
      )}
    </div>
  );
}

/** The two ways forward from an analysis, and the picker that decides which round the next one continues from. */
function RoundActions({
  pending,
  rounds,
  continueFrom,
  onRefine,
  onCreateSpecPr,
  onContinueFrom,
}: {
  pending: boolean;
  rounds: ReturnType<typeof rewindOptions>;
  continueFrom: number | undefined;
  onRefine: () => void;
  onCreateSpecPr: () => void;
  onContinueFrom: (iteration: number) => void;
}) {
  return (
    <div className={styles.actions}>
      <SubmitButton
        type="button"
        pending={pending}
        pendingLabel="Working…"
        onClick={onRefine}
      >
        Refine again
      </SubmitButton>
      <button
        type="button"
        className="button"
        disabled={pending}
        onClick={onCreateSpecPr}
      >
        Create the spec PR
      </button>
      {rounds.length > 1 && (
        <RewindPicker
          rounds={rounds}
          continueFrom={continueFrom}
          disabled={pending}
          onChange={onContinueFrom}
        />
      )}
    </div>
  );
}

/** Which earlier round the next one continues from. Rounds after the chosen one stay on record; they are simply not carried forward. */
function RewindPicker({
  rounds,
  continueFrom,
  disabled,
  onChange,
}: {
  rounds: ReturnType<typeof rewindOptions>;
  continueFrom: number | undefined;
  disabled: boolean;
  onChange: (iteration: number) => void;
}) {
  return (
    <label className={`meta ${styles.continueFrom}`}>
      Continue from{" "}
      <select
        value={continueFrom ?? rounds[0].iteration}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
      >
        {rounds.map((r) => (
          <option key={r.iteration} value={r.iteration}>
            {lineageLabel(r) ? `${r.label} — ${lineageLabel(r)}` : r.label}
          </option>
        ))}
      </select>
    </label>
  );
}

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
function phaseView({
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
