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
  // Seeded from the server render so the first paint is not empty; the mount fetch adds task, run and live output.
  const { data: poll, refresh: fetchLatest } = useFeaturePlanningPoll({
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
  const latestReady = latest?.status === "ready" && !!latest.gap_result;
  const failed = phase.kind === "failed";

  useRefreshWhenRoundLands(latestReady, latest?.iteration ?? null);

  // Server-rendered feature refreshed when round lands; poll carries only latest iteration, not history.
  const rounds = rewindOptions(feature.iterations);
  const rewinding = isRewind(rounds, continueFrom);

  const submitRefine = () =>
    startTransition(async () => {
      await refine(toUserAnswers(feedback), continueFrom);
      setFeedback(emptyFeedback());
      setContinueFrom(undefined);
      await fetchLatest();
    });

  // Accept carries the same answers as refine to avoid dropping last form input.
  const submitCreateSpecFile = () =>
    startTransition(async () => {
      setFinalizing(true);
      await onFinalize(toUserAnswers(feedback));
      setFeedback(emptyFeedback());
      await fetchLatest();
    });

  useRefreshWhenPlanningEnds(finalizing, poll.feature.status);

  const iteration = latest?.iteration ?? poll.feature.current_iteration;

  const phaseCard = phaseView({
    phase,
    poll,
    settledView,
    iteration,
    timeoutMinutes,
    finalizing,
    latestCreatedAt: latest?.created_at,
  });

  if (phaseCard) {
    return phaseCard;
  }

  return (
    <AnalysisView
      iteration={iteration}
      failed={failed}
      gap={
        latestReady
          ? (latest?.gap_result ?? null)
          : (poll.lastReady?.gap_result ?? null)
      }
      failureReason={poll.task?.failure_reason}
      answers={latest?.user_answers}
      run={poll.run}
      pending={pending}
      feedback={feedback}
      onChangeFeedback={setFeedback}
      onCreateDraft={onCreateDraft}
      onRefine={submitRefine}
      onCreateSpecPr={submitCreateSpecFile}
      rounds={rounds}
      continueFrom={continueFrom}
      onContinueFrom={setContinueFrom}
      rewinding={rewinding}
    />
  );
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
  onChangeFeedback,
  onCreateDraft,
  onRefine,
  onCreateSpecPr,
  rounds,
  continueFrom,
  onContinueFrom,
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
  onChangeFeedback: (next: FeedbackState) => void;
  onCreateDraft: (title: string, prompt: string) => void;
  onRefine: () => void;
  onCreateSpecPr: () => void;
  rounds: ReturnType<typeof rewindOptions>;
  continueFrom: number | undefined;
  onContinueFrom: (iteration: number) => void;
  rewinding: boolean;
}) {
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
      {rewinding && (
        <p className={`meta ${styles.rewindNote}`} role="status">
          This round continues round {continueFrom} — rounds after it stay on
          record but are not carried forward.
        </p>
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

/** What the machine is doing, if anything: the finished view, the parked spec PR, the decompose progress, or the running card. Returns null when the line wants nothing said and the author's analysis view takes over. */
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
  // Gated on the FEATURE as well as the line: a legacy feature mints one line per round, which reports `done` while the author still has a decision to make.
  if (phase.kind === "done" && !isPlanningActive(poll.feature.status)) {
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
  const working = phase.kind === "planning" || phase.kind === "writing-spec";
  // `finalizing` bridges only until the first poll shows the line moving; a line that ends without a PR must give the controls back.
  const showSpec =
    phase.kind === "writing-spec" ||
    (finalizing && (poll.run?.status ?? "running") === "running");

  if (!working && !showSpec) {
    return null;
  }

  // Same card as a planning round: same line, and the author has no decision to make while it runs.
  return (
    <RunningCard
      iteration={iteration}
      // The working NODE's start, not the round's, or a late spec node reads as over budget.
      since={"since" in phase ? (phase.since ?? latestCreatedAt) : undefined}
      timeoutMinutes={timeoutMinutes}
      // Counts against THAT node's kill deadline, not the round's unenforced budget.
      nodeId={"nodeId" in phase ? phase.nodeId : undefined}
      liveOutput={poll.liveOutput}
      run={poll.run}
      phase={showSpec ? "spec" : "round"}
    />
  );
}
